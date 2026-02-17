import { Log } from "../util/log.js"
import { Instance } from "../project/instance.js"
import { FileIgnore } from "../file/ignore.js"
import { Chunking } from "./chunking.js"
import { VectorStore } from "./lancedb.js"
import { Bus } from "../bus/index.js"
import { BusEvent } from "../bus/bus-event.js"
import { Embeddings } from "./embeddings.js"
import { TreeShaker } from "./tree-shaker.js"
import z from "zod"
import path from "path"
import { Ripgrep } from "../file/ripgrep.js"
import fs from "fs/promises"
import crypto from "crypto"

// TESTE_WATCHER_1766603500000 - Comentário de teste do watcher - não remover durante teste
const log = Log.create({ service: "semantic.indexer" })

export namespace Indexer {
  // Supported file extensions for indexing
  const INDEXABLE_EXTENSIONS = new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".py",
    ".go",
    ".rs",
    ".java",
    ".c",
    ".cpp",
    ".h",
    ".hpp",
    ".cs",
    ".rb",
    ".php",
    ".swift",
    ".kt",
    ".scala",
    ".vue",
    ".svelte",
    ".md",
    ".mdx",
    ".txt",
    ".json",
    ".yaml",
    ".yml",
    ".toml",
  ])

  type FileStat = { 
    size: number
    mtimeMs: number
    hash?: string
    chunks?: string[]
    /** Pre-computed collapsible regions for tree-shaking */
    collapsibleRegions?: TreeShaker.CollapsibleRegion[]
  }

  type Document = {
    id: string
    content: string
    contentRaw: string
    metadata: Record<string, string | number | boolean | null>
    hash: string
  }

  function hashContent(content: string): string {
    return crypto.createHash("sha1").update(content).digest("hex")
  }

  function extractRawContentFromLines(lines: string[], startLine: number, endLine: number): string {
    if (!lines.length) return ""
    const start = Math.max(1, startLine)
    const end = Math.min(lines.length, endLine)
    if (end < start) return ""
    return lines.slice(start - 1, end).join("\n")
  }

  // Max file size to index (500KB)
  const MAX_FILE_SIZE = 500 * 1024
  // Batch documents to reduce embedding overhead during full indexing
  const ADD_BATCH_SIZE = 256

  // Events for progress reporting
  export const Event = {
    Progress: BusEvent.define(
      "semantic.indexer.progress",
      z.object({
        phase: z.enum(["scanning", "indexing", "complete", "error"]),
        current: z.number(),
        total: z.number(),
        file: z.string().optional(),
        message: z.string().optional(),
      }),
    ),
  }

  /**
   * Check if file should be indexed
   */
  export function isIndexableFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase()
    return INDEXABLE_EXTENSIONS.has(ext)
  }

  function shouldIndex(filePath: string): boolean {
    return isIndexableFile(filePath)
  }

  /**
   * Get all indexable files in the project
   */
  async function getFiles(): Promise<string[]> {
    const files: string[] = []

    for await (const file of Ripgrep.files({ cwd: Instance.directory })) {
      if (!shouldIndex(file)) continue
      if (FileIgnore.match(file)) continue
      files.push(file)
    }

    return files
  }

  /**
   * Index a single file
   */
  async function indexFile(
    collection: Awaited<ReturnType<typeof VectorStore.getCollection>>,
    filePath: string,
    options?: {
      skipDelete?: boolean
      content?: string
      size?: number
      documents?: Document[]
    },
  ): Promise<{ count: number; chunkHashes: string[] }> {
    const fullPath = path.join(Instance.directory, filePath)
    const stat = await fs.stat(fullPath).catch(() => null)
    if (!stat) return { count: 0, chunkHashes: [] }

    // Check file size
    const size = options?.size ?? stat.size
    if (size > MAX_FILE_SIZE) {
      log.info("skipping large file", { filePath, size })
      return { count: 0, chunkHashes: [] }
    }

    // Read content
    const content = options?.content ?? (await fs.readFile(fullPath, "utf8").catch(() => ""))
    if (!content.trim()) return { count: 0, chunkHashes: [] }

    // Delete existing chunks for this file unless we're building a fresh collection
    if (options?.skipDelete !== true) {
      await VectorStore.deleteByFile(collection, filePath)
    }

    const documents = options?.documents ?? (await buildDocuments({ filePath, content }))
    if (documents.length === 0) return { count: 0, chunkHashes: [] }

    // Add to vector store
    await VectorStore.addDocuments(
      collection,
      documents.map(({ id, content, contentRaw, metadata }) => ({ id, content, contentRaw, metadata })),
    )

    return { count: documents.length, chunkHashes: documents.map((d) => d.hash) }
  }

  async function buildDocuments(input: { filePath: string; content: string }): Promise<Document[]> {
    const chunks = await Chunking.chunkAsync(input.content, input.filePath)
    if (chunks.length === 0) return []

    const chunksWithOverlap = Chunking.addOverlap(chunks)
    const lines = input.content.split("\n")

    return chunksWithOverlap.map((chunk, i) => ({
      id: `${input.filePath}:${i}`,
      content: chunk.content,
      contentRaw: extractRawContentFromLines(lines, chunk.startLine, chunk.endLine),
      hash: hashContent(chunk.content),
      metadata: {
        file: input.filePath,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        chunkIndex: i,
        type: chunk.type,
        // Include semantic metadata if present
        ...(chunk.symbolName && { symbolName: chunk.symbolName }),
        ...(chunk.symbolType && { symbolType: chunk.symbolType }),
        ...(chunk.complexity !== undefined && { complexity: chunk.complexity }),
        ...(chunk.isExported !== undefined && { isExported: chunk.isExported }),
        ...(chunk.parentScope && { parentScope: chunk.parentScope }),
        ...(chunk.scopeDepth !== undefined && { scopeDepth: chunk.scopeDepth }),
        ...(chunk.hasDocumentation !== undefined && { hasDocumentation: chunk.hasDocumentation }),
        ...(chunk.language && { language: chunk.language }),
        ...(chunk.imports && { imports: chunk.imports }),
        // Multilingual support fields
        ...(chunk.variant && { variant: chunk.variant }),
        ...(chunk.isAsync !== undefined && { isAsync: chunk.isAsync }),
        ...(chunk.isStatic !== undefined && { isStatic: chunk.isStatic }),
        ...(chunk.isAbstract !== undefined && { isAbstract: chunk.isAbstract }),
        ...(chunk.decorators && chunk.decorators.length > 0 && { decorators: chunk.decorators.join(",") }),
      },
    }))
  }

  // Concurrency limit for parallel file preparation
  const FILE_CONCURRENCY = 8

  /**
   * Run async tasks with bounded concurrency
   */
  async function mapConcurrent<T, R>(
    items: T[],
    concurrency: number,
    fn: (item: T, index: number) => Promise<R>,
  ): Promise<R[]> {
    const results: R[] = new Array(items.length)
    let next = 0
    async function worker() {
      while (next < items.length) {
        const i = next++
        results[i] = await fn(items[i], i)
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()))
    return results
  }

  type PreparedFile = {
    file: string
    stat: { size: number; mtimeMs: number }
    hash: string
    collapsibleRegions: TreeShaker.CollapsibleRegion[]
    documents: Document[]
  }

  /**
   * Full index of the project
   */
  export async function indexProject(): Promise<{
    files: number
    chunks: number
    duration: number
  }> {
    const start = Date.now()
    log.info("starting full index", { project: Instance.directory })

    // Emit scanning phase
    Bus.publish(Event.Progress, {
      phase: "scanning",
      current: 0,
      total: 0,
      message: "Scanning files...",
    })

    // Get all files
    const files = await getFiles()
    log.info("found files to index", { count: files.length })

    // Clear existing data for fresh index (best-effort if first run)
    await VectorStore.deleteCollection(Instance.directory).catch(() => {})
    const freshCollection = await VectorStore.getCollection(Instance.directory)

    // --- Pass 1: Parallel file preparation (I/O + parsing + chunking) ---
    let progressCounter = 0
    const prepared = await mapConcurrent(files, FILE_CONCURRENCY, async (file) => {
      const idx = ++progressCounter
      Bus.publish(Event.Progress, {
        phase: "indexing",
        current: idx,
        total: files.length,
        file,
      })

      try {
        const fullPath = path.join(Instance.directory, file)
        const stat = await fs.stat(fullPath).catch(() => null)
        if (!stat) return null
        if (stat.size > MAX_FILE_SIZE) {
          log.info("skipping large file", { filePath: file, size: stat.size })
          return null
        }

        const content = await fs.readFile(fullPath, "utf8").catch(() => "")
        if (!content.trim()) return null

        // Run tree-shaker regions and chunking concurrently per file
        const [collapsibleRegions, documents] = await Promise.all([
          TreeShaker.extractRegions(file, content),
          buildDocuments({ filePath: file, content }),
        ])

        if (documents.length === 0) return null

        return {
          file,
          stat: { size: stat.size, mtimeMs: stat.mtimeMs },
          hash: hashContent(content),
          collapsibleRegions,
          documents,
        } as PreparedFile
      } catch (err) {
        log.warn("failed to prepare file", { file, error: err instanceof Error ? err.message : String(err) })
        return null
      }
    })

    // --- Pass 2: Collect results and batch embed ---
    let indexed = 0
    let totalChunks = 0
    const fileStats: Record<string, FileStat> = {}
    const allDocs: {
      id: string
      content: string
      contentRaw: string
      metadata: Record<string, string | number | boolean | null>
    }[] = []

    for (const item of prepared) {
      if (!item) continue
      indexed++
      totalChunks += item.documents.length
      fileStats[item.file] = {
        size: item.stat.size,
        mtimeMs: item.stat.mtimeMs,
        hash: item.hash,
        chunks: item.documents.map((d) => d.hash),
        collapsibleRegions: item.collapsibleRegions,
      }
      for (const doc of item.documents) {
        allDocs.push({ id: doc.id, content: doc.content, contentRaw: doc.contentRaw, metadata: doc.metadata })
      }
    }

    // Flush in large batches for maximum embedding throughput
    for (let i = 0; i < allDocs.length; i += ADD_BATCH_SIZE) {
      await VectorStore.addDocuments(freshCollection, allDocs.slice(i, i + ADD_BATCH_SIZE))
    }

    const config = Embeddings.getConfig()
    await VectorStore.writeIndexMeta(Instance.directory, {
      version: 1,
      root: Instance.directory,
      embeddings: {
        provider: config.provider,
        model: config.embedModel,
        dimension: config.embedDim,
        ...(config.device ? { device: config.device } : {}),
      },
      files: fileStats,
      updatedAt: Date.now(),
    })

    const duration = Date.now() - start

    Bus.publish(Event.Progress, {
      phase: "complete",
      current: indexed,
      total: files.length,
      message: `Indexed ${indexed} files (${totalChunks} chunks) in ${(duration / 1000).toFixed(1)}s`,
    })

    log.info("indexing complete", {
      files: indexed,
      chunks: totalChunks,
      duration,
    })

    return { files: indexed, chunks: totalChunks, duration }
  }

  /**
   * Incremental index: only re-index files that changed since last index.
   * Falls back to full index if no metadata exists or embeddings config changed.
   */
  export async function indexProjectIncremental(): Promise<{
    files: number
    chunks: number
    duration: number
    skipped: number
    removed: number
    mode: "incremental" | "full"
  }> {
    const start = Date.now()
    log.info("starting incremental index", { project: Instance.directory })

    const files = await getFiles()
    log.info("found files to scan", { count: files.length })

    const meta = await VectorStore.readIndexMeta(Instance.directory)
    const config = Embeddings.getConfig()
    const provider = config.provider
    const dimension = config.embedDim
    const model = config.embedModel

    if (
      !meta ||
      meta.embeddings?.dimension !== dimension ||
      meta.embeddings?.provider !== provider ||
      meta.embeddings?.model !== model
    ) {
      const full = await indexProject()
      return { ...full, skipped: 0, removed: 0, mode: "full" }
    }

    const collection = await VectorStore.getCollection(Instance.directory)

    let indexed = 0
    let totalChunks = 0
    let skipped = 0
    const newStats: Record<string, FileStat> = {}
    const previous = meta.files || {}
    const remaining = new Set(Object.keys(previous))
    let removed = 0

    // Actions to batch after parallel preparation
    type FileAction =
      | { action: "skip"; file: string; stats: FileStat }
      | { action: "delete"; file: string }
      | { action: "partial_update"; file: string; stats: FileStat; changedDocs: Document[] }
      | { action: "full_reindex"; file: string; stats: FileStat; documents: Document[] }

    // --- Phase 1: Parallel file preparation (stat, read, hash, chunk) ---
    const actions = await mapConcurrent(files, FILE_CONCURRENCY, async (file): Promise<FileAction | null> => {
      try {
        const fullPath = path.join(Instance.directory, file)
        const stat = await fs.stat(fullPath).catch(() => null)
        if (!stat) return null
        if (stat.size > MAX_FILE_SIZE) return null // Leave in remaining for removal

        const current: FileStat = { size: stat.size, mtimeMs: stat.mtimeMs }
        const prev = previous[file]

        // Fast path: unchanged by size + mtime
        if (prev && prev.size === current.size && prev.mtimeMs === current.mtimeMs) {
          return { action: "skip", file, stats: prev }
        }

        const content = await fs.readFile(fullPath, "utf8").catch(() => "")
        if (!content.trim()) {
          return { action: "delete", file }
        }

        const hash = hashContent(content)

        // Unchanged by content hash
        if (prev && prev.hash && prev.hash === hash) {
          return { action: "skip", file, stats: { ...current, hash, chunks: prev.chunks, collapsibleRegions: prev.collapsibleRegions } }
        }

        // File changed - chunk and prepare documents
        const [collapsibleRegions, documents] = await Promise.all([
          TreeShaker.extractRegions(file, content),
          buildDocuments({ filePath: file, content }),
        ])

        if (documents.length === 0) {
          return { action: "delete", file }
        }

        const chunkHashes = documents.map((d) => d.hash)

        // Check for partial update (same chunk count, some changed)
        if (prev?.chunks && prev.chunks.length === chunkHashes.length) {
          const changedIndexes: number[] = []
          for (let j = 0; j < chunkHashes.length; j++) {
            if (chunkHashes[j] !== prev.chunks[j]) changedIndexes.push(j)
          }

          if (changedIndexes.length === 0) {
            return { action: "skip", file, stats: { ...current, hash, chunks: chunkHashes, collapsibleRegions: prev.collapsibleRegions } }
          }

          const changedDocs = changedIndexes.map((j) => documents[j]).filter(Boolean)
          return { action: "partial_update", file, stats: { ...current, hash, chunks: chunkHashes, collapsibleRegions }, changedDocs }
        }

        // Full reindex for this file
        return { action: "full_reindex", file, stats: { ...current, hash, chunks: chunkHashes, collapsibleRegions }, documents }
      } catch (err) {
        log.warn("failed to prepare file for incremental index", { file, error: err instanceof Error ? err.message : String(err) })
        return null
      }
    })

    // --- Phase 2: Process actions sequentially (vector store operations) ---
    // Collect docs to batch embed
    const docsToUpdate: { id: string; content: string; contentRaw: string; metadata: Record<string, string | number | boolean | null> }[] = []
    const filesToDeleteFirst: string[] = []
    const docsToAdd: { id: string; content: string; contentRaw: string; metadata: Record<string, string | number | boolean | null> }[] = []

    for (const act of actions) {
      if (!act) continue

      remaining.delete(act.file)

      switch (act.action) {
        case "skip":
          skipped++
          newStats[act.file] = act.stats
          break

        case "delete":
          await VectorStore.deleteByFile(collection, act.file)
          removed++
          break

        case "partial_update":
          docsToUpdate.push(
            ...act.changedDocs.map(({ id, content: docContent, contentRaw, metadata }) => ({
              id, content: docContent, contentRaw, metadata,
            })),
          )
          indexed++
          totalChunks += act.changedDocs.length
          newStats[act.file] = act.stats
          break

        case "full_reindex":
          filesToDeleteFirst.push(act.file)
          docsToAdd.push(
            ...act.documents.map(({ id, content: docContent, contentRaw, metadata }) => ({
              id, content: docContent, contentRaw, metadata,
            })),
          )
          indexed++
          totalChunks += act.documents.length
          newStats[act.file] = act.stats
          break
      }
    }

    // Batch delete files that need full reindex
    for (const file of filesToDeleteFirst) {
      await VectorStore.deleteByFile(collection, file)
    }

    // Batch update changed chunks
    if (docsToUpdate.length > 0) {
      for (let i = 0; i < docsToUpdate.length; i += ADD_BATCH_SIZE) {
        await VectorStore.updateDocuments(collection, docsToUpdate.slice(i, i + ADD_BATCH_SIZE))
      }
    }

    // Batch add new/fully-reindexed documents
    if (docsToAdd.length > 0) {
      for (let i = 0; i < docsToAdd.length; i += ADD_BATCH_SIZE) {
        await VectorStore.addDocuments(collection, docsToAdd.slice(i, i + ADD_BATCH_SIZE))
      }
    }

    // Remove files that no longer exist
    if (remaining.size > 0) {
      for (const file of remaining) {
        await VectorStore.deleteByFile(collection, file)
        removed++
      }
    }

    await VectorStore.writeIndexMeta(Instance.directory, {
      version: 1,
      root: Instance.directory,
      embeddings: { provider, model, dimension, ...(config.device ? { device: config.device } : {}) },
      files: newStats,
      updatedAt: Date.now(),
    })

    const duration = Date.now() - start
    return { files: indexed, chunks: totalChunks, duration, skipped, removed, mode: "incremental" }
  }

  /**
   * Incremental update for a single file
   */
  export async function updateFile(filePath: string): Promise<void> {
    if (!shouldIndex(filePath)) return
    if (FileIgnore.match(filePath)) return

    log.info("updating file in index", { file: filePath })

    const fullPath = path.join(Instance.directory, filePath)
    const stat = await fs.stat(fullPath).catch(() => null)
    if (!stat) return
    if (stat.size > MAX_FILE_SIZE) return

    const content = await fs.readFile(fullPath, "utf8").catch(() => "")
    const collection = await VectorStore.getCollection(Instance.directory)
    if (!content.trim()) {
      await VectorStore.deleteByFile(collection, filePath)
      const meta = await VectorStore.readIndexMeta(Instance.directory)
      if (meta?.files) {
        delete meta.files[filePath]
        meta.updatedAt = Date.now()
        await VectorStore.writeIndexMeta(Instance.directory, meta)
      }
      return
    }

    const documents = await buildDocuments({ filePath, content })
    await VectorStore.updateDocuments(
      collection,
      documents.map(({ id, content: docContent, contentRaw, metadata }) => ({
        id,
        content: docContent,
        contentRaw,
        metadata,
      })),
    )
    const meta = await VectorStore.readIndexMeta(Instance.directory)
    if (meta?.files) {
      meta.files[filePath] = {
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        hash: hashContent(content),
        chunks: documents.map((d) => d.hash),
      }
      meta.updatedAt = Date.now()
      await VectorStore.writeIndexMeta(Instance.directory, meta)
    }
  }

  /**
   * Remove file from index
   */
  export async function removeFile(filePath: string): Promise<void> {
    log.info("removing file from index", { file: filePath })

    const collection = await VectorStore.getCollection(Instance.directory)
    await VectorStore.deleteByFile(collection, filePath)
    const meta = await VectorStore.readIndexMeta(Instance.directory)
    if (meta?.files) {
      delete meta.files[filePath]
      meta.updatedAt = Date.now()
      await VectorStore.writeIndexMeta(Instance.directory, meta)
    }
  }

  /**
   * Check if index exists for project
   */
  export function hasIndex(): Promise<boolean> {
    return VectorStore.hasCollection(Instance.directory)
  }

  /**
   * Get index stats
   */
  export async function getStats(): Promise<{
    indexed: boolean
    chunks: number
    files: number
    embeddings?: { provider: string; model?: string; dimension: number; device?: string }
    updatedAt?: number
  }> {
    const hasIt = await hasIndex()
    if (!hasIt) return { indexed: false, chunks: 0, files: 0 }

    const meta = await VectorStore.readIndexMeta(Instance.directory)
    if (!meta) return { indexed: false, chunks: 0, files: 0 }

    // Get chunk count without validating dimension (to allow reading stats before configuring embeddings)
    const collection = await VectorStore.getCollectionUnsafe(Instance.directory)
    const stats = await VectorStore.getStats(collection)

    return {
      indexed: true,
      chunks: stats.count,
      files: meta?.files ? Object.keys(meta.files).length : 0,
      embeddings: meta?.embeddings,
      updatedAt: meta?.updatedAt,
    }
  }

  /**
   * Verify index against current filesystem content using hashes only (no reindex).
   */
  export async function verifyIndex(): Promise<{
    indexed: boolean
    files: number
    changed: number
    missing: number
    removed: number
    embeddings?: { provider: string; model?: string; dimension: number; device?: string }
    updatedAt?: number
  }> {
    const meta = await VectorStore.readIndexMeta(Instance.directory)
    if (!meta) {
      return { indexed: false, files: 0, changed: 0, missing: 0, removed: 0 }
    }

    const files = await getFiles()
    const previous = meta.files || {}
    const remaining = new Set(Object.keys(previous))
    let changed = 0
    let missing = 0

    for (const file of files) {
      const fullPath = path.join(Instance.directory, file)
      const stat = await fs.stat(fullPath).catch(() => null)
      if (!stat) continue
      if (stat.size > MAX_FILE_SIZE) {
        // Large files are not indexed; ignore them for verification.
        remaining.delete(file)
        continue
      }

      const prev = previous[file]
      if (!prev) {
        missing++
        continue
      }

      const content = await fs.readFile(fullPath, "utf8").catch(() => "")
      const hash = content.trim() ? hashContent(content) : ""
      if (!hash || prev.hash !== hash) {
        changed++
      }

      remaining.delete(file)
    }

    const removed = remaining.size

    return {
      indexed: true,
      files: Object.keys(previous).length,
      changed,
      missing,
      removed,
      embeddings: meta.embeddings,
      updatedAt: meta.updatedAt,
    }
  }
}
