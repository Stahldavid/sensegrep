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
    metadata: Record<string, string | number | boolean | null>
    hash: string
  }

  function hashContent(content: string): string {
    return crypto.createHash("sha1").update(content).digest("hex")
  }

  // Max file size to index (500KB)
  const MAX_FILE_SIZE = 500 * 1024
  // Batch documents to reduce embedding overhead during full indexing
  const ADD_BATCH_SIZE = 64

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
      documents.map(({ id, content, metadata }) => ({ id, content, metadata })),
    )

    return { count: documents.length, chunkHashes: documents.map((d) => d.hash) }
  }

  async function buildDocuments(input: { filePath: string; content: string }): Promise<Document[]> {
    const chunks = await Chunking.chunkAsync(input.content, input.filePath)
    if (chunks.length === 0) return []

    const chunksWithOverlap = Chunking.addOverlap(chunks)

    return chunksWithOverlap.map((chunk, i) => ({
      id: `${input.filePath}:${i}`,
      content: chunk.content,
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
      },
    }))
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

    let indexed = 0
    let totalChunks = 0
    const fileStats: Record<string, FileStat> = {}

    let batch: {
      id: string
      content: string
      metadata: Record<string, string | number | boolean | null>
    }[] = []

    const flush = async () => {
      if (batch.length === 0) return
      await VectorStore.addDocuments(freshCollection, batch)
      batch = []
    }

    // Index each file
    for (let i = 0; i < files.length; i++) {
      const file = files[i]

      Bus.publish(Event.Progress, {
        phase: "indexing",
        current: i + 1,
        total: files.length,
        file,
      })

      const fullPath = path.join(Instance.directory, file)
      const stat = await fs.stat(fullPath).catch(() => null)
      if (!stat) continue
      const size = stat.size
      if (size > MAX_FILE_SIZE) {
        log.info("skipping large file", { filePath: file, size })
        continue
      }

      const content = await fs.readFile(fullPath, "utf8").catch(() => "")
      if (!content.trim()) continue

      // Extract collapsible regions for tree-shaking (done during indexing to avoid re-parsing)
      const collapsibleRegions = await TreeShaker.extractRegions(file, content)

      const documents = await buildDocuments({ filePath: file, content })
      if (documents.length === 0) continue

      if (stat) {
        fileStats[file] = {
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          hash: hashContent(content),
          chunks: documents.map((d) => d.hash),
          collapsibleRegions,
        }
      }

      indexed++
      totalChunks += documents.length
      batch.push(...documents.map(({ id, content: docContent, metadata }) => ({ id, content: docContent, metadata })))

      if (batch.length >= ADD_BATCH_SIZE) {
        await flush()
      }
    }

    await flush()

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

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const fullPath = path.join(Instance.directory, file)
      const stat = await fs.stat(fullPath).catch(() => null)
      if (!stat) continue
      if (stat.size > MAX_FILE_SIZE) {
        // Leave in remaining so any previous index entries get removed
        continue
      }

      const current: FileStat = { size: stat.size, mtimeMs: stat.mtimeMs }
      const prev = previous[file]
      if (prev && prev.size === current.size && prev.mtimeMs === current.mtimeMs) {
        skipped++
        newStats[file] = prev
        remaining.delete(file)
        continue
      }

      const content = await fs.readFile(fullPath, "utf8").catch(() => "")
      if (!content.trim()) {
        await VectorStore.deleteByFile(collection, file)
        remaining.delete(file)
        removed++
        continue
      }
      const hash = hashContent(content)
      if (prev && prev.hash && prev.hash === hash) {
        skipped++
        // Keep existing collapsible regions when file hasn't changed
        newStats[file] = { ...current, hash, chunks: prev.chunks, collapsibleRegions: prev.collapsibleRegions }
        remaining.delete(file)
        continue
      }

      // Extract collapsible regions for tree-shaking
      const collapsibleRegions = await TreeShaker.extractRegions(file, content)

      const documents = await buildDocuments({ filePath: file, content })
      if (documents.length === 0) {
        await VectorStore.deleteByFile(collection, file)
        remaining.delete(file)
        removed++
        continue
      }

      const chunkHashes = documents.map((d) => d.hash)
      if (prev?.chunks && prev.chunks.length === chunkHashes.length) {
        const changedIndexes: number[] = []
        for (let i = 0; i < chunkHashes.length; i++) {
          if (chunkHashes[i] !== prev.chunks[i]) changedIndexes.push(i)
        }

        if (changedIndexes.length === 0) {
          skipped++
          // Keep existing collapsible regions when chunks haven't changed
          newStats[file] = { ...current, hash, chunks: chunkHashes, collapsibleRegions: prev.collapsibleRegions }
          remaining.delete(file)
          continue
        }

        const changedDocs = changedIndexes.map((i) => documents[i]).filter(Boolean)
        await VectorStore.updateDocuments(
          collection,
          changedDocs.map(({ id, content: docContent, metadata }) => ({ id, content: docContent, metadata })),
        )
        indexed++
        totalChunks += changedDocs.length
        newStats[file] = { ...current, hash, chunks: chunkHashes, collapsibleRegions }
        remaining.delete(file)
        continue
      }

      // Fallback: reindex full file
      await VectorStore.deleteByFile(collection, file)
      await VectorStore.addDocuments(
        collection,
        documents.map(({ id, content: docContent, metadata }) => ({ id, content: docContent, metadata })),
      )
      indexed++
      totalChunks += documents.length
      newStats[file] = { ...current, hash, chunks: chunkHashes, collapsibleRegions }
      remaining.delete(file)
    }

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
      documents.map(({ id, content: docContent, metadata }) => ({ id, content: docContent, metadata })),
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
