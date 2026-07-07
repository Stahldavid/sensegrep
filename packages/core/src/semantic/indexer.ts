import { Log } from "../util/log.js"
import { Instance } from "../project/instance.js"
import { shouldIgnoreIndexedFile, clearProjectIndexFilterCache } from "./index-filters.js"
import { Chunking } from "./chunking.js"
import { VectorStore } from "./lancedb.js"
import { Bus } from "../bus/index.js"
import { BusEvent } from "../bus/bus-event.js"
import { Embeddings } from "./embeddings.js"
import { TreeShaker } from "./tree-shaker.js"
import { Global } from "../global/index.js"
import z from "zod"
import path from "path"
import { Ripgrep } from "../file/ripgrep.js"
import fs from "fs/promises"
import crypto from "crypto"

// TESTE_WATCHER_1766603500000 - Comentário de teste do watcher - não remover durante teste
const log = Log.create({ service: "semantic.indexer" })

export namespace Indexer {
  function normalizeIndexedFilePath(filePath: string): string {
    return filePath.replace(/\\/g, "/").replace(/^\.\//, "")
  }

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
  // Batch documents to reduce embedding overhead during full indexing. Local
  // embedding servers (Ollama / fastembed-rs) can be much slower per large
  // request than hosted APIs, so keep their request batches intentionally small.
  // SENSEGREP_EMBED_BATCH_SIZE is primarily an operational escape hatch for
  // constrained droplets; persistence still reuses the same size safely.
  const DEFAULT_ADD_BATCH_SIZE = 256
  const LOCAL_ADD_BATCH_SIZE = 16
  const ADD_BATCH_SIZE = (() => {
    const configured = process.env.SENSEGREP_EMBED_BATCH_SIZE
    if (configured) {
      const parsed = Number(configured)
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`SENSEGREP_EMBED_BATCH_SIZE must be a positive number, got "${configured}".`)
      }
      return Math.max(1, Math.floor(parsed))
    }
    // Full-index batches feed EmbeddingsRemote, which further slices local-provider
    // HTTP calls. Keeping this at the historical hosted default avoids slowing cloud
    // providers while still allowing droplets to override it explicitly.
    return process.env.SENSEGREP_PROVIDER === "ollama" || process.env.SENSEGREP_PROVIDER === "fastembed"
      ? LOCAL_ADD_BATCH_SIZE
      : DEFAULT_ADD_BATCH_SIZE
  })()
  const INDEX_LOCK_TIMEOUT_MS = 10 * 60_000
  const INDEX_LOCK_STALE_MS = 30 * 60_000
  let inProcessLockDepth = 0

  export type IndexProgressPhase = "lock" | "scan" | "parse" | "embed" | "persist" | "complete" | "error"

  export type IndexProgress = {
    phase: IndexProgressPhase
    current: number
    total: number
    file?: string
    message?: string
    filesParsed?: number
    chunksPrepared?: number
    chunksEmbedded?: number
    chunksPersisted?: number
    skipped?: number
    failed?: number
  }

  export type IndexRunOptions = {
    timeoutMs?: number
    maxFiles?: number
    onProgress?: (progress: IndexProgress) => void
  }

  function createRunContext(options: IndexRunOptions = {}) {
    const startedAt = Date.now()
    const timeoutMs = options.timeoutMs

    function assertNotTimedOut(phase: string): void {
      if (!timeoutMs || timeoutMs <= 0) return
      const elapsed = Date.now() - startedAt
      if (elapsed > timeoutMs) {
        throw new Error(`sensegrep index timed out after ${Math.ceil(timeoutMs / 1000)}s during ${phase}`)
      }
    }

    async function withTimeout<T>(promise: Promise<T>, phase: string): Promise<T> {
      if (!timeoutMs || timeoutMs <= 0) return promise
      const remaining = timeoutMs - (Date.now() - startedAt)
      if (remaining <= 0) {
        throw new Error(`sensegrep index timed out after ${Math.ceil(timeoutMs / 1000)}s during ${phase}`)
      }
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        return await Promise.race([
          promise,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`sensegrep index timed out after ${Math.ceil(timeoutMs / 1000)}s during ${phase}`)),
              remaining,
            )
          }),
        ])
      } finally {
        if (timer) clearTimeout(timer)
      }
    }

    function emit(progress: IndexProgress): void {
      options.onProgress?.(progress)
      const phase = progress.phase === "scan" ? "scanning" : progress.phase === "parse" ? "indexing" : progress.phase
      Bus.publish(Event.Progress, {
        phase: phase === "embed" || phase === "persist" || phase === "lock" ? "indexing" : phase,
        current: progress.current,
        total: progress.total,
        file: progress.file,
        message: progress.message,
      }).catch(() => {})
    }

    return { assertNotTimedOut, withTimeout, emit }
  }

  function projectLockPath(): string {
    const hash = crypto.createHash("sha1").update(path.resolve(Instance.directory)).digest("hex").slice(0, 16)
    return path.join(Global.Path.data, "locks", `index-${hash}.lock`)
  }

  async function wait(ms: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, ms))
  }

  async function acquireIndexLock(options: IndexRunOptions = {}): Promise<() => Promise<void>> {
    if (inProcessLockDepth > 0) {
      inProcessLockDepth++
      return async () => {
        inProcessLockDepth--
      }
    }

    const lockPath = projectLockPath()
    const start = Date.now()
    const lockTimeoutMs = options.timeoutMs && options.timeoutMs > 0
      ? Math.min(INDEX_LOCK_TIMEOUT_MS, options.timeoutMs)
      : INDEX_LOCK_TIMEOUT_MS
    await fs.mkdir(path.dirname(lockPath), { recursive: true })
    let lastNotice = 0

    while (true) {
      try {
        const handle = await fs.open(lockPath, "wx")
        await handle.writeFile(JSON.stringify({
          pid: process.pid,
          root: Instance.directory,
          startedAt: Date.now(),
        }))
        await handle.close()
        inProcessLockDepth = 1
        return async () => {
          inProcessLockDepth--
          if (inProcessLockDepth === 0) {
            await fs.rm(lockPath, { force: true }).catch(() => {})
          }
        }
      } catch (error: any) {
        if (error?.code !== "EEXIST") throw error

        const stat = await fs.stat(lockPath).catch(() => null)
        if (stat && Date.now() - stat.mtimeMs > INDEX_LOCK_STALE_MS) {
          await fs.rm(lockPath, { force: true }).catch(() => {})
          continue
        }

        if (Date.now() - start > lockTimeoutMs) {
          throw new Error(`Timed out waiting for sensegrep index lock for ${Instance.directory}`)
        }

        if (Date.now() - lastNotice > 5_000) {
          lastNotice = Date.now()
          options.onProgress?.({
            phase: "lock",
            current: Date.now() - start,
            total: lockTimeoutMs,
            message: `Index already running for this project; waiting for lock (${Math.ceil((Date.now() - start) / 1000)}s)`,
          })
        }

        await wait(500)
      }
    }
  }

  async function withIndexLock<T>(options: IndexRunOptions, fn: () => Promise<T>): Promise<T> {
    const release = await acquireIndexLock(options)
    try {
      return await fn()
    } finally {
      await release()
    }
  }

  function assertEmbeddingsConfigured(): void {
    const config = Embeddings.getConfig()

    if (config.provider === "gemini" && !config.apiKey) {
      throw new Error(
        "Gemini embeddings are configured but no API key was found. " +
          "Set GEMINI_API_KEY or GOOGLE_API_KEY, configure `sensegrep.geminiApiKey` in VS Code, " +
          "or switch to `--provider ollama`, `--provider fastembed`, `--provider openai`, or `--provider bedrock`.",
      )
    }

    if (config.provider === "openai" && !config.apiKey) {
      throw new Error(
        "OpenAI-compatible embeddings are configured but no API key was found. " +
          "Set SENSEGREP_OPENAI_API_KEY, FIREWORKS_API_KEY, or OPENAI_API_KEY, " +
          "or add \"apiKey\" to ~/.config/sensegrep/config.json.",
      )
    }
  }

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

  // Index options for controlling what gets indexed
  let indexOptions: { includeDocs?: boolean; includeConfig?: boolean } = {}

  export function setIndexOptions(options: { includeDocs?: boolean; includeConfig?: boolean }): void {
    indexOptions = options
  }

  function getFileKind(filePath: string): "code" | "doc" | "config" {
    const ext = path.extname(filePath).toLowerCase()
    const baseName = path.basename(filePath).toLowerCase()

    // Config files
    if (
      ext === ".json" ||
      ext === ".yaml" ||
      ext === ".yml" ||
      ext === ".toml" ||
      ext === ".ini" ||
      ext === ".conf" ||
      baseName.startsWith("tsconfig") ||
      baseName.startsWith("jest.config") ||
      baseName.startsWith("vitest.config") ||
      baseName.startsWith("webpack") ||
      baseName.startsWith("rollup") ||
      baseName.startsWith("babel") ||
      baseName.startsWith("eslint") ||
      baseName.startsWith("prettier") ||
      baseName === "package.json" ||
      baseName === "package-lock.json"
    ) {
      return "config"
    }

    // Doc files
    if (
      ext === ".md" ||
      ext === ".mdx" ||
      ext === ".txt" ||
      ext === ".rst" ||
      baseName === "changelog" ||
      baseName === "readme" ||
      baseName.startsWith("readme.") ||
      baseName.startsWith("changelog.") ||
      baseName.startsWith("contributing.") ||
      baseName.startsWith("license.")
    ) {
      return "doc"
    }

    return "code"
  }

  function shouldIndex(filePath: string): boolean {
    if (!isIndexableFile(filePath)) return false

    const fileKind = getFileKind(filePath)

    // Filter out docs and config by default
    if (fileKind === "doc" && !indexOptions.includeDocs) {
      return false
    }
    if (fileKind === "config" && !indexOptions.includeConfig) {
      return false
    }

    return true
  }

  function isProbablyMinifiedOrGenerated(filePath: string, content: string): boolean {
    if (/\.(min)\.(js|mjs|cjs|css)$/i.test(filePath)) return true

    const lineCount = Math.max(1, content.split("\n").length)
    const maxLineLength = content.split("\n").reduce((max, line) => Math.max(max, line.length), 0)
    const averageLineLength = Math.ceil(content.length / lineCount)
    const veryLongLineCount = content.split("\n").filter((line) => line.length >= 10_000).length

    return (
      content.length >= 50_000 &&
      (lineCount <= 5 || maxLineLength >= 20_000 || (averageLineLength >= 2_000 && veryLongLineCount >= 1))
    )
  }

  /**
   * Get all indexable files in the project
   */
  async function getFiles(): Promise<string[]> {
    clearProjectIndexFilterCache(Instance.directory)
    const files: string[] = []

    for await (const file of Ripgrep.files({ cwd: Instance.directory })) {
      const normalized = normalizeIndexedFilePath(file)
      if (!shouldIndex(normalized)) continue
      if (shouldIgnoreIndexedFile(Instance.directory, normalized)) continue
      files.push(normalized)
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
    filePath = normalizeIndexedFilePath(filePath)
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
    if (isProbablyMinifiedOrGenerated(filePath, content)) {
      log.info("skipping generated or minified file", { filePath, size, lineCount: content.split("\n").length })
      return { count: 0, chunkHashes: [] }
    }

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
    const normalizedFilePath = normalizeIndexedFilePath(input.filePath)
    const chunks = await Chunking.chunkAsync(input.content, normalizedFilePath)
    if (chunks.length === 0) return []

    const chunksWithOverlap = Chunking.addOverlap(chunks)
    const lines = input.content.split("\n")
    const fileKind = getFileKind(normalizedFilePath)

    return chunksWithOverlap.map((chunk, i) => ({
      id: `${normalizedFilePath}:${i}`,
      content: chunk.content,
      contentRaw: extractRawContentFromLines(lines, chunk.startLine, chunk.endLine),
      hash: hashContent(chunk.content),
      metadata: {
        file: normalizedFilePath,
        fileKind,
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
        ...(chunk.semanticKind && { semanticKind: chunk.semanticKind }),
        ...(chunk.framework && { framework: chunk.framework }),
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
  async function indexProjectUnlocked(options: IndexRunOptions = {}): Promise<{
    files: number
    chunks: number
    duration: number
  }> {
    const start = Date.now()
    const run = createRunContext(options)
    try {
      log.info("starting full index", { project: Instance.directory })
      assertEmbeddingsConfigured()

      run.emit({
        phase: "scan",
        current: 0,
        total: 0,
        message: "Scanning files...",
      })

      let files = await run.withTimeout(getFiles(), "scan")
      if (options.maxFiles && options.maxFiles > 0 && files.length > options.maxFiles) {
        files = files.slice(0, options.maxFiles)
      }
      log.info("found files to index", { count: files.length })
      run.emit({
        phase: "scan",
        current: files.length,
        total: files.length,
        message: `Found ${files.length} indexable files`,
      })

      // --- Pass 1: Parallel file preparation (I/O + parsing + chunking) ---
      let progressCounter = 0
      let filesParsed = 0
      let chunksPrepared = 0
      let failed = 0
      const prepared = await mapConcurrent(files, FILE_CONCURRENCY, async (file) => {
        run.assertNotTimedOut("parse")
        const idx = ++progressCounter
        run.emit({
          phase: "parse",
          current: idx,
          total: files.length,
          file,
          filesParsed,
          chunksPrepared,
          failed,
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
          if (isProbablyMinifiedOrGenerated(file, content)) {
            log.info("skipping generated or minified file", { filePath: file, size: stat.size })
            return null
          }

          // Run tree-shaker regions and chunking concurrently per file
          const [collapsibleRegions, documents] = await Promise.all([
            TreeShaker.extractRegions(file, content),
            buildDocuments({ filePath: file, content }),
          ])

          if (documents.length === 0) return null
          filesParsed++
          chunksPrepared += documents.length

          return {
            file,
            stat: { size: stat.size, mtimeMs: stat.mtimeMs },
            hash: hashContent(content),
            collapsibleRegions,
            documents,
          } as PreparedFile
        } catch (err) {
          failed++
          log.warn("failed to prepare file", { file, error: err instanceof Error ? err.message : String(err) })
          return null
        }
      })
      run.emit({
        phase: "parse",
        current: files.length,
        total: files.length,
        message: `Parsed ${filesParsed} files into ${chunksPrepared} chunks`,
        filesParsed,
        chunksPrepared,
        failed,
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

      // Prepare embeddings before replacing the old collection. If the provider
      // hangs or fails, the previous index remains readable.
      const embeddedRows: VectorStore.EmbeddedDocumentRow[] = []
      for (let i = 0; i < allDocs.length; i += ADD_BATCH_SIZE) {
        run.assertNotTimedOut("embed")
        const batch = allDocs.slice(i, i + ADD_BATCH_SIZE)
        run.emit({
          phase: "embed",
          current: i,
          total: allDocs.length,
          message: `Embedding chunks ${i + 1}-${Math.min(i + batch.length, allDocs.length)} of ${allDocs.length}`,
          filesParsed: indexed,
          chunksPrepared: totalChunks,
          chunksEmbedded: embeddedRows.length,
          failed,
        })
        embeddedRows.push(...(await run.withTimeout(VectorStore.embedDocuments(batch), "embed")))
      }
      run.emit({
        phase: "embed",
        current: embeddedRows.length,
        total: allDocs.length,
        message: `Embedded ${embeddedRows.length} chunks`,
        filesParsed: indexed,
        chunksPrepared: totalChunks,
        chunksEmbedded: embeddedRows.length,
        failed,
      })

      run.assertNotTimedOut("persist")
      await VectorStore.deleteCollection(Instance.directory).catch(() => {})
      const freshCollection = await VectorStore.getCollection(Instance.directory)

      // Flush already-embedded rows, avoiding remote calls after the old index is removed.
      let chunksPersisted = 0
      for (let i = 0; i < embeddedRows.length; i += ADD_BATCH_SIZE) {
        run.assertNotTimedOut("persist")
        const batch = embeddedRows.slice(i, i + ADD_BATCH_SIZE)
        await run.withTimeout(VectorStore.addEmbeddedDocuments(freshCollection, batch), "persist")
        chunksPersisted += batch.length
        run.emit({
          phase: "persist",
          current: chunksPersisted,
          total: embeddedRows.length,
          message: `Persisted ${chunksPersisted}/${embeddedRows.length} chunks`,
          filesParsed: indexed,
          chunksPrepared: totalChunks,
          chunksEmbedded: embeddedRows.length,
          chunksPersisted,
          failed,
        })
      }

      // Verify that all chunks were actually persisted
      const finalStats = await VectorStore.getStats(freshCollection)
      if (finalStats.count !== allDocs.length) {
        log.warn("chunk persistence mismatch detected", {
          expected: allDocs.length,
          actual: finalStats.count,
        })
      }

      const config = Embeddings.getConfig()
      await VectorStore.writeIndexMeta(Instance.directory, {
        version: 1,
        root: Instance.directory,
        embeddings: {
          provider: config.provider,
          model: config.embedModel,
          dimension: config.embedDim,
          distanceMetric: VectorStore.DEFAULT_DISTANCE_METRIC,
        },
        files: fileStats,
        updatedAt: Date.now(),
      })

      const duration = Date.now() - start

      run.emit({
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
    } catch (error) {
      run.emit({
        phase: "error",
        current: 0,
        total: 0,
        message: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  export async function indexProject(options: IndexRunOptions = {}): Promise<{
    files: number
    chunks: number
    duration: number
  }> {
    return withIndexLock(options, () => indexProjectUnlocked(options))
  }

  /**
   * Incremental index: only re-index files that changed since last index.
   * Falls back to full index if no metadata exists or embeddings config changed.
   */
  async function indexProjectIncrementalUnlocked(options: IndexRunOptions = {}): Promise<{
    files: number
    chunks: number
    duration: number
    skipped: number
    removed: number
    mode: "incremental" | "full"
  }> {
    const start = Date.now()
    const run = createRunContext(options)
    try {
      log.info("starting incremental index", { project: Instance.directory })
      assertEmbeddingsConfigured()

      run.emit({ phase: "scan", current: 0, total: 0, message: "Scanning files..." })
      let files = await run.withTimeout(getFiles(), "scan")
      const truncatedByMaxFiles = !!(options.maxFiles && options.maxFiles > 0 && files.length > options.maxFiles)
      if (options.maxFiles && options.maxFiles > 0 && files.length > options.maxFiles) {
        files = files.slice(0, options.maxFiles)
      }
      log.info("found files to scan", { count: files.length })
      run.emit({ phase: "scan", current: files.length, total: files.length, message: `Found ${files.length} indexable files` })

      const meta = await VectorStore.readIndexMeta(Instance.directory)
      const config = Embeddings.getConfig()
      const provider = config.provider
      const dimension = config.embedDim
      const model = config.embedModel

      if (
        !meta ||
        meta.embeddings?.dimension !== dimension ||
        meta.embeddings?.provider !== provider ||
        meta.embeddings?.model !== model ||
        meta.embeddings?.distanceMetric !== VectorStore.DEFAULT_DISTANCE_METRIC
      ) {
        const full = await indexProjectUnlocked(options)
        return { ...full, skipped: 0, removed: 0, mode: "full" }
      }

      // Check for chunk consistency between meta and LanceDB
      let expectedChunks = 0
      for (const fileStat of Object.values(meta.files || {})) {
        if (fileStat.chunks) {
          expectedChunks += fileStat.chunks.length
        }
      }

      const collection = await VectorStore.getCollection(Instance.directory)
      const stats = await VectorStore.getStats(collection)
      const actualChunks = stats.count

      if (expectedChunks > 0 && actualChunks !== expectedChunks) {
        log.warn("chunk mismatch detected, falling back to full rebuild", {
          expectedChunks,
          actualChunks,
        })
        const full = await indexProjectUnlocked(options)
        return { ...full, skipped: 0, removed: 0, mode: "full" }
      }

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
        | { action: "full_reindex"; file: string; stats: FileStat; documents: Document[] }

      // --- Phase 1: Parallel file preparation (stat, read, hash, chunk) ---
      let preparedCount = 0
      let failed = 0
      const actions = await mapConcurrent(files, FILE_CONCURRENCY, async (file): Promise<FileAction | null> => {
        run.assertNotTimedOut("parse")
        preparedCount++
        run.emit({
          phase: "parse",
          current: preparedCount,
          total: files.length,
          file,
          skipped,
          failed,
        })
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
          if (isProbablyMinifiedOrGenerated(file, content)) {
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

          // Check for unchanged chunk hashes. Changed files are reindexed as a
          // whole file to avoid stale/duplicate chunks in append-oriented stores.
          if (prev?.chunks && prev.chunks.length === chunkHashes.length) {
            let changed = false
            for (let j = 0; j < chunkHashes.length; j++) {
              if (chunkHashes[j] !== prev.chunks[j]) {
                changed = true
                break
              }
            }

            if (!changed) {
              return { action: "skip", file, stats: { ...current, hash, chunks: chunkHashes, collapsibleRegions: prev.collapsibleRegions } }
            }
          }

          // Full reindex for this file
          return { action: "full_reindex", file, stats: { ...current, hash, chunks: chunkHashes, collapsibleRegions }, documents }
        } catch (err) {
          failed++
          log.warn("failed to prepare file for incremental index", { file, error: err instanceof Error ? err.message : String(err) })
          return null
        }
      })

      // --- Phase 2: Process actions sequentially (vector store operations) ---
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

      // Prepare embeddings before deleting old file chunks. If embedding fails,
      // the previous index remains intact.
      const embeddedRows: VectorStore.EmbeddedDocumentRow[] = []
      if (docsToAdd.length > 0) {
        for (let i = 0; i < docsToAdd.length; i += ADD_BATCH_SIZE) {
          run.assertNotTimedOut("embed")
          const batch = docsToAdd.slice(i, i + ADD_BATCH_SIZE)
          run.emit({
            phase: "embed",
            current: i,
            total: docsToAdd.length,
            message: `Embedding changed chunks ${i + 1}-${Math.min(i + batch.length, docsToAdd.length)} of ${docsToAdd.length}`,
            chunksPrepared: docsToAdd.length,
            chunksEmbedded: embeddedRows.length,
            skipped,
            failed,
          })
          embeddedRows.push(...(await run.withTimeout(VectorStore.embedDocuments(batch), "embed")))
        }
      }

      // Batch delete files that need full reindex
      for (const file of filesToDeleteFirst) {
        run.assertNotTimedOut("persist")
        await VectorStore.deleteByFile(collection, file)
      }

      // Batch add new/fully-reindexed documents
      if (embeddedRows.length > 0) {
        let chunksPersisted = 0
        for (let i = 0; i < embeddedRows.length; i += ADD_BATCH_SIZE) {
          run.assertNotTimedOut("persist")
          const batch = embeddedRows.slice(i, i + ADD_BATCH_SIZE)
          await run.withTimeout(VectorStore.addEmbeddedDocuments(collection, batch), "persist")
          chunksPersisted += batch.length
          run.emit({
            phase: "persist",
            current: chunksPersisted,
            total: embeddedRows.length,
            message: `Persisted ${chunksPersisted}/${embeddedRows.length} changed chunks`,
            chunksPrepared: docsToAdd.length,
            chunksEmbedded: embeddedRows.length,
            chunksPersisted,
            skipped,
            failed,
          })
        }
      }

      // Remove files that no longer exist
      if (remaining.size > 0 && !truncatedByMaxFiles) {
        for (const file of remaining) {
          await VectorStore.deleteByFile(collection, file)
          removed++
        }
      } else if (truncatedByMaxFiles) {
        for (const file of remaining) {
          const prev = previous[file]
          if (prev) newStats[file] = prev
        }
      }

      let nextExpectedChunks = 0
      for (const fileStat of Object.values(newStats)) {
        nextExpectedChunks += fileStat.chunks?.length ?? 0
      }
      const nextStats = await VectorStore.getStats(collection)
      if (nextExpectedChunks > 0 && nextStats.count !== nextExpectedChunks) {
        log.warn("chunk mismatch after incremental update, falling back to full rebuild", {
          expectedChunks: nextExpectedChunks,
          actualChunks: nextStats.count,
        })
        const full = await indexProjectUnlocked(options)
        return { ...full, skipped, removed, mode: "full" }
      }

      await VectorStore.writeIndexMeta(Instance.directory, {
        version: 1,
        root: Instance.directory,
        embeddings: { provider, model, dimension, distanceMetric: VectorStore.DEFAULT_DISTANCE_METRIC },
        files: newStats,
        updatedAt: Date.now(),
      })

      const duration = Date.now() - start
      run.emit({
        phase: "complete",
        current: indexed,
        total: files.length,
        message: `Indexed ${indexed} changed files (${totalChunks} chunks), skipped ${skipped}, removed ${removed} in ${(duration / 1000).toFixed(1)}s`,
        chunksPrepared: docsToAdd.length,
        chunksEmbedded: embeddedRows.length,
        skipped,
        failed,
      })
      return { files: indexed, chunks: totalChunks, duration, skipped, removed, mode: "incremental" }
    } catch (error) {
      run.emit({
        phase: "error",
        current: 0,
        total: 0,
        message: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  export async function indexProjectIncremental(options: IndexRunOptions = {}): Promise<{
    files: number
    chunks: number
    duration: number
    skipped: number
    removed: number
    mode: "incremental" | "full"
  }> {
    return withIndexLock(options, () => indexProjectIncrementalUnlocked(options))
  }

  /**
   * Incremental update for a single file
   */
  export async function updateFile(filePath: string): Promise<void> {
    filePath = normalizeIndexedFilePath(filePath)
    if (!shouldIndex(filePath)) return
    if (shouldIgnoreIndexedFile(Instance.directory, filePath)) return
    assertEmbeddingsConfigured()

    log.info("updating file in index", { file: filePath })

    const fullPath = path.join(Instance.directory, filePath)
    const stat = await fs.stat(fullPath).catch(() => null)
    if (!stat) return
    if (stat.size > MAX_FILE_SIZE) return

    const content = await fs.readFile(fullPath, "utf8").catch(() => "")
    const collection = await VectorStore.getCollection(Instance.directory)
    if (isProbablyMinifiedOrGenerated(filePath, content)) {
      await VectorStore.deleteByFile(collection, filePath)
      return
    }
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
    const docsToAdd = documents.map(({ id, content: docContent, contentRaw, metadata }) => ({
      id,
      content: docContent,
      contentRaw,
      metadata,
    }))
    const embeddedRows = await VectorStore.embedDocuments(docsToAdd)
    await VectorStore.deleteByFile(collection, filePath)
    await VectorStore.addEmbeddedDocuments(collection, embeddedRows)
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
    filePath = normalizeIndexedFilePath(filePath)
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

  function scopedMetaEntries(
    meta: NonNullable<Awaited<ReturnType<typeof VectorStore.readIndexMeta>>>,
    subdirPrefix?: string,
  ): Array<[string, FileStat]> {
    const entries = Object.entries(meta.files || {}) as Array<[string, FileStat]>
    if (!subdirPrefix) return entries
    const normalizedPrefix = normalizeIndexedFilePath(subdirPrefix).replace(/\/$/, "")
    return entries.filter(([file]) => file === normalizedPrefix || file.startsWith(`${normalizedPrefix}/`))
  }

  function toResolvedMetaPath(file: string, subdirPrefix?: string): string {
    const normalizedFile = normalizeIndexedFilePath(file)
    if (!subdirPrefix) return normalizedFile
    const normalizedPrefix = normalizeIndexedFilePath(subdirPrefix).replace(/\/$/, "")
    return normalizedFile ? `${normalizedPrefix}/${normalizedFile}` : normalizedPrefix
  }

  async function countActualChunks(
    collection: Awaited<ReturnType<typeof VectorStore.getCollectionUnsafe>>,
    subdirPrefix?: string,
  ): Promise<number> {
    if (!subdirPrefix) {
      return (await VectorStore.getStats(collection)).count
    }
    const normalizedPrefix = normalizeIndexedFilePath(subdirPrefix).replace(/\/$/, "")
    const rows = await VectorStore.listDocuments(collection, {
      filters: {
        any: [
          { key: "file", operator: "equals", value: normalizedPrefix },
          { key: "file", operator: "starts_with", value: `${normalizedPrefix}/` },
        ],
      },
      columns: ["id", "file"],
    })
    return rows.length
  }

  /**
   * Get index stats with chunk consistency check
   */
  export async function getStats(): Promise<{
    indexed: boolean
    chunks: number
    files: number
    expectedChunks?: number
    actualChunks?: number
    chunkMismatch?: boolean
    embeddings?: { provider: string; model?: string; dimension: number; device?: string; distanceMetric?: VectorStore.DistanceMetric }
    updatedAt?: number
  }> {
    const resolved = await VectorStore.resolveIndexedProject(Instance.directory)
    if (!resolved?.meta) return { indexed: false, chunks: 0, files: 0 }

    // Get chunk count without validating dimension (to allow reading stats before configuring embeddings)
    const collection = await VectorStore.getCollectionUnsafe(resolved.root, resolved.meta.embeddings.dimension)
    const actualChunks = await countActualChunks(collection, resolved.subdirPrefix)
    const entries = scopedMetaEntries(resolved.meta, resolved.subdirPrefix)

    // Calculate expected chunks from meta
    let expectedChunks = 0
    for (const [, fileStat] of entries) {
      if (fileStat.chunks) {
        expectedChunks += fileStat.chunks.length
      }
    }

    const chunkMismatch = expectedChunks > 0 && actualChunks !== expectedChunks

    return {
      indexed: true,
      chunks: actualChunks,
      files: entries.length,
      expectedChunks,
      actualChunks,
      chunkMismatch,
      embeddings: resolved.meta.embeddings,
      updatedAt: resolved.meta.updatedAt,
    }
  }

  /**
   * Verify index against current filesystem content using hashes only (no reindex).
   * Also checks for consistency between metadata and LanceDB table.
   */
  export async function verifyIndex(): Promise<{
    indexed: boolean
    files: number
    changed: number
    missing: number
    removed: number
    changedFiles?: string[]
    missingFiles?: string[]
    removedFiles?: string[]
    expectedChunks?: number
    actualChunks?: number
    chunkMismatch?: boolean
    embeddings?: { provider: string; model?: string; dimension: number; device?: string; distanceMetric?: VectorStore.DistanceMetric }
    updatedAt?: number
  }> {
    const resolved = await VectorStore.resolveIndexedProject(Instance.directory)
    if (!resolved?.meta) {
      return { indexed: false, files: 0, changed: 0, missing: 0, removed: 0 }
    }
    const meta = resolved.meta

    const files = await getFiles()
    const previous = Object.fromEntries(scopedMetaEntries(meta, resolved.subdirPrefix)) as Record<string, FileStat>
    const remaining = new Set(Object.keys(previous))
    let changed = 0
    let missing = 0
    const changedFiles: string[] = []
    const missingFiles: string[] = []

    for (const file of files) {
      const fullPath = path.join(Instance.directory, file)
      const stat = await fs.stat(fullPath).catch(() => null)
      if (!stat) continue
      if (stat.size > MAX_FILE_SIZE) {
        // Large files are not indexed; ignore them for verification.
        remaining.delete(toResolvedMetaPath(file, resolved.subdirPrefix))
        continue
      }

      const metaPath = toResolvedMetaPath(file, resolved.subdirPrefix)
      const prev = previous[metaPath]
      if (!prev) {
        missing++
        missingFiles.push(metaPath)
        continue
      }

      const content = await fs.readFile(fullPath, "utf8").catch(() => "")
      const hash = content.trim() ? hashContent(content) : ""
      if (!hash || prev.hash !== hash) {
        changed++
        changedFiles.push(metaPath)
      }

      remaining.delete(metaPath)
    }

    const removed = remaining.size
    const removedFiles = [...remaining]

    // Check for chunk consistency between meta and LanceDB
    let expectedChunks = 0
    for (const fileStat of Object.values(previous)) {
      if (fileStat.chunks) {
        expectedChunks += fileStat.chunks.length
      }
    }

    const collection = await VectorStore.getCollectionUnsafe(resolved.root, meta.embeddings.dimension)
    const actualChunks = await countActualChunks(collection, resolved.subdirPrefix)
    const chunkMismatch = expectedChunks > 0 && actualChunks !== expectedChunks

    return {
      indexed: true,
      files: Object.keys(previous).length,
      changed,
      missing,
      removed,
      changedFiles,
      missingFiles,
      removedFiles,
      expectedChunks,
      actualChunks,
      chunkMismatch,
      embeddings: meta.embeddings,
      updatedAt: meta.updatedAt,
    }
  }
}
