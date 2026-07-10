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
import {
  getFileKind,
  isIndexableFilePath,
  isProbablyMinifiedOrGenerated,
  shouldIndexFile,
} from "./index-file-rules.js"
import { getChunkingSignature } from "./chunk-limits.js"
import { loadLanguagePlugins } from "./language/index.js"
import { embeddingConfigFingerprint } from "./embedding-config.js"
import z from "zod"
import path from "path"
import { Ripgrep } from "../file/ripgrep.js"
import fs from "fs/promises"
import crypto from "crypto"
import { AsyncLocalStorage } from "node:async_hooks"

const log = Log.create({ service: "semantic.indexer" })

export namespace Indexer {
  function normalizeIndexedFilePath(filePath: string): string {
    return filePath.replace(/\\/g, "/").replace(/^\.\//, "")
  }

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
  // embedding servers such as Ollama can be much slower per large
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
    return process.env.SENSEGREP_PROVIDER === "ollama"
      ? LOCAL_ADD_BATCH_SIZE
      : DEFAULT_ADD_BATCH_SIZE
  })()
  const EMBED_BATCH_CONCURRENCY = (() => {
    const configured = process.env.SENSEGREP_INDEX_EMBED_CONCURRENCY
    if (!configured) return 1
    const parsed = Number(configured)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`SENSEGREP_INDEX_EMBED_CONCURRENCY must be a positive number, got "${configured}".`)
    }
    return Math.max(1, Math.floor(parsed))
  })()
  const INDEX_LOCK_TIMEOUT_MS = 10 * 60_000
  const INDEX_LOCK_STALE_MS = 30 * 60_000
  const heldIndexLocks = new AsyncLocalStorage<Set<string>>()
  const processLockTails = new Map<string, Promise<void>>()

  function sameChunkingSignature(
    a: VectorStore.IndexMeta["chunking"] | undefined,
    b: VectorStore.IndexMeta["chunking"],
  ): boolean {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  }

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
    reusedChunks?: number
    chunksPersisted?: number
    estimatedTokens?: number
    requests?: number
    elapsedMs?: number
    etaMs?: number
    skipped?: number
    failed?: number
  }

  export type IndexRunOptions = {
    timeoutMs?: number
    maxFiles?: number
    onProgress?: (progress: IndexProgress) => void
    signal?: AbortSignal
    resume?: boolean
  }

  export type IndexPlan = {
    mode: "full" | "incremental"
    files: number
    added: string[]
    changed: string[]
    removed: string[]
    unchanged: number
    chunks: number
    estimatedTokens: number
    estimatedRequests: number
    provider: string
    model: string
    dimension: number
    batchSize: number
  }

  function createRunContext(options: IndexRunOptions = {}) {
    const startedAt = Date.now()
    const timeoutMs = options.timeoutMs
    const controller = new AbortController()
    const abortFromCaller = () => controller.abort(options.signal?.reason)
    if (options.signal?.aborted) abortFromCaller()
    else options.signal?.addEventListener("abort", abortFromCaller, { once: true })

    function timeoutError(phase: string): Error {
      return new Error(`sensegrep index timed out after ${Math.ceil((timeoutMs ?? 0) / 1000)}s during ${phase}`)
    }

    function assertNotTimedOut(phase: string): void {
      controller.signal.throwIfAborted()
      if (!timeoutMs || timeoutMs <= 0) return
      const elapsed = Date.now() - startedAt
      if (elapsed > timeoutMs) {
        const error = timeoutError(phase)
        controller.abort(error)
        throw error
      }
    }

    async function withTimeout<T>(promise: Promise<T>, phase: string): Promise<T> {
      if (!timeoutMs || timeoutMs <= 0) return promise
      const remaining = timeoutMs - (Date.now() - startedAt)
      if (remaining <= 0) {
        const error = timeoutError(phase)
        controller.abort(error)
        throw error
      }
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        return await Promise.race([
          promise,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              const error = timeoutError(phase)
              controller.abort(error)
              reject(error)
            }, remaining)
          }),
        ])
      } finally {
        if (timer) clearTimeout(timer)
      }
    }

    function emit(progress: IndexProgress): void {
      const elapsedMs = Date.now() - startedAt
      const etaMs = progress.current > 0 && progress.total > progress.current
        ? Math.round((elapsedMs / progress.current) * (progress.total - progress.current))
        : 0
      const enriched = { ...progress, elapsedMs, etaMs }
      options.onProgress?.(enriched)
      const phase = progress.phase === "scan" ? "scanning" : progress.phase === "parse" ? "indexing" : progress.phase
      Bus.publish(Event.Progress, {
        phase: phase === "embed" || phase === "persist" || phase === "lock" ? "indexing" : phase,
        current: progress.current,
        total: progress.total,
        file: progress.file,
        message: progress.message,
      }).catch(() => {})
    }

    function dispose(): void {
      options.signal?.removeEventListener("abort", abortFromCaller)
    }

    return { assertNotTimedOut, withTimeout, emit, signal: controller.signal, dispose }
  }

  function projectLockPath(rootDir: string): string {
    const hash = crypto.createHash("sha1").update(rootDir).digest("hex").slice(0, 16)
    return path.join(Global.Path.data, "locks", `index-${hash}.lock`)
  }

  async function wait(ms: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, ms))
  }

  function isPidAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) return false
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  async function acquireProcessLock(rootDir: string): Promise<() => void> {
    const previous = processLockTails.get(rootDir) ?? Promise.resolve()
    let releaseGate!: () => void
    const gate = new Promise<void>((resolve) => { releaseGate = resolve })
    const tail = previous.then(() => gate)
    processLockTails.set(rootDir, tail)
    await previous

    let released = false
    return () => {
      if (released) return
      released = true
      releaseGate()
      if (processLockTails.get(rootDir) === tail) processLockTails.delete(rootDir)
    }
  }

  async function acquireIndexLock(rootDir: string, options: IndexRunOptions = {}): Promise<() => Promise<void>> {
    const lockPath = projectLockPath(rootDir)
    const start = Date.now()
    const lockTimeoutMs = options.timeoutMs && options.timeoutMs > 0
      ? Math.min(INDEX_LOCK_TIMEOUT_MS, options.timeoutMs)
      : INDEX_LOCK_TIMEOUT_MS
    await fs.mkdir(path.dirname(lockPath), { recursive: true })
    let lastNotice = 0
    const token = crypto.randomUUID()

    while (true) {
      try {
        const handle = await fs.open(lockPath, "wx")
        await handle.writeFile(JSON.stringify({
          pid: process.pid,
          root: rootDir,
          token,
          startedAt: Date.now(),
        }))
        await handle.close()
        return async () => {
          const owner = await fs.readFile(lockPath, "utf8")
            .then((raw) => JSON.parse(raw) as { token?: string })
            .catch(() => null)
          if (owner?.token === token) await fs.rm(lockPath, { force: true }).catch(() => {})
        }
      } catch (error: any) {
        if (error?.code !== "EEXIST") throw error

        const owner = await fs.readFile(lockPath, "utf8")
          .then((raw) => JSON.parse(raw) as { pid?: number })
          .catch(() => null)
        const stat = await fs.stat(lockPath).catch(() => null)
        const ownerIsDead = typeof owner?.pid === "number" && !isPidAlive(owner.pid)
        const unreadableAndStale = !owner && !!stat && Date.now() - stat.mtimeMs > INDEX_LOCK_STALE_MS
        if (ownerIsDead || unreadableAndStale) {
          await fs.rm(lockPath, { force: true }).catch(() => {})
          continue
        }

        if (Date.now() - start > lockTimeoutMs) {
          throw new Error(`Timed out waiting for sensegrep index lock for ${rootDir}`)
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
    const rootDir = path.resolve(Instance.directory)
    const inherited = heldIndexLocks.getStore()
    if (inherited?.has(rootDir)) return fn()

    const releaseProcessLock = await acquireProcessLock(rootDir)
    let releaseFileLock: (() => Promise<void>) | undefined
    try {
      releaseFileLock = await acquireIndexLock(rootDir, options)
      const held = new Set(inherited)
      held.add(rootDir)
      return await heldIndexLocks.run(held, fn)
    } finally {
      await releaseFileLock?.()
      releaseProcessLock()
    }
  }

  function assertEmbeddingsConfigured(): void {
    const config = Embeddings.getConfig()

    if (config.provider === "gemini" && !config.apiKey) {
      throw new Error(
        "Gemini embeddings are configured but no API key was found. " +
          "Set GEMINI_API_KEY or GOOGLE_API_KEY, configure `sensegrep.geminiApiKey` in VS Code, " +
          "or switch to `--provider ollama`, `--provider openai`, or `--provider bedrock`.",
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
    return isIndexableFilePath(filePath)
  }

  // Index options for controlling what gets indexed
  let indexOptions: { includeDocs?: boolean; includeConfig?: boolean } = {}

  export function setIndexOptions(options: { includeDocs?: boolean; includeConfig?: boolean }): void {
    indexOptions = options
  }

  function shouldIndex(filePath: string): boolean {
    return shouldIndexFile(filePath, indexOptions)
  }

  /**
   * Get all indexable files in the project
   */
  async function getFiles(signal?: AbortSignal): Promise<string[]> {
    await loadLanguagePlugins(Instance.directory)
    clearProjectIndexFilterCache(Instance.directory)
    const files: string[] = []

    for await (const file of Ripgrep.files({ cwd: Instance.directory, signal })) {
      signal?.throwIfAborted()
      const normalized = normalizeIndexedFilePath(file)
      if (!shouldIndex(normalized)) continue
      if (shouldIgnoreIndexedFile(Instance.directory, normalized)) continue
      files.push(normalized)
    }

    return files
  }

  function estimateEmbeddingTokens(text: string): number {
    return Math.max(1, Math.ceil(text.length / 4))
  }

  function configBatchSize(): number {
    return Math.max(1, Math.floor(Embeddings.getConfig().batchSize ?? ADD_BATCH_SIZE))
  }

  /** Build an indexing plan using only local I/O and parsing. */
  export async function planIndex(options: IndexRunOptions & { full?: boolean } = {}): Promise<IndexPlan> {
    let files = await getFiles(options.signal)
    const truncated = !!(options.maxFiles && options.maxFiles > 0 && files.length > options.maxFiles)
    if (truncated) files = files.slice(0, options.maxFiles)

    const config = Embeddings.getConfig()
    const chunking = getChunkingSignature(config)
    const meta = await VectorStore.readIndexMeta(Instance.directory)
    const compatible = !!meta &&
      meta.embeddings?.provider === config.provider &&
      meta.embeddings?.model === config.embedModel &&
      meta.embeddings?.dimension === config.embedDim &&
      (!meta.embeddings?.configFingerprint || meta.embeddings.configFingerprint === embeddingConfigFingerprint(config)) &&
      meta.embeddings?.distanceMetric === VectorStore.DEFAULT_DISTANCE_METRIC &&
      sameChunkingSignature(meta.chunking, chunking)
    const mode = options.full || !compatible ? "full" : "incremental"
    const previous = mode === "incremental" ? (meta?.files ?? {}) : {}
    const remaining = new Set(Object.keys(previous))
    const added: string[] = []
    const changed: string[] = []
    let unchanged = 0
    let chunks = 0
    let estimatedTokens = 0

    await mapConcurrent(files, FILE_CONCURRENCY, async (file, index) => {
      options.signal?.throwIfAborted()
      options.onProgress?.({ phase: "parse", current: index + 1, total: files.length, file })
      remaining.delete(file)
      const fullPath = path.join(Instance.directory, file)
      const stat = await fs.stat(fullPath).catch(() => null)
      if (!stat || stat.size > MAX_FILE_SIZE) return
      const prev = previous[file]
      if (prev && prev.size === stat.size && prev.mtimeMs === stat.mtimeMs) {
        unchanged++
        return
      }
      const content = await fs.readFile(fullPath, "utf8").catch(() => "")
      if (!content.trim() || isProbablyMinifiedOrGenerated(file, content)) return
      const hash = hashContent(content)
      if (prev?.hash === hash) {
        unchanged++
        return
      }
      const documents = await buildDocuments({ filePath: file, content })
      if (documents.length === 0) return
      if (prev) changed.push(file)
      else added.push(file)
      chunks += documents.length
      estimatedTokens += documents.reduce((total, document) => total + estimateEmbeddingTokens(document.content), 0)
    })

    const removed = truncated ? [] : [...remaining].sort()
    added.sort()
    changed.sort()
    const batchSize = Math.max(1, Math.floor(config.batchSize ?? ADD_BATCH_SIZE))
    return {
      mode,
      files: files.length,
      added,
      changed,
      removed,
      unchanged,
      chunks,
      estimatedTokens,
      estimatedRequests: chunks === 0 ? 0 : Math.ceil(chunks / batchSize),
      provider: config.provider,
      model: config.embedModel,
      dimension: config.embedDim,
      batchSize,
    }
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

  async function deleteFileFromIndexAndMeta(
    collection: Awaited<ReturnType<typeof VectorStore.getCollection>>,
    filePath: string,
  ): Promise<void> {
    await VectorStore.deleteByFile(collection, filePath)
    const meta = await VectorStore.readIndexMeta(Instance.directory)
    if (meta?.files) {
      delete meta.files[filePath]
      meta.updatedAt = Date.now()
      await VectorStore.writeIndexMeta(Instance.directory, meta)
    }
  }

  async function deleteIndexedFileIfPresent(filePath: string): Promise<void> {
    const meta = await VectorStore.readIndexMeta(Instance.directory)
    if (!meta?.files || !meta.files[filePath]) return

    if (await VectorStore.hasCollection(Instance.directory)) {
      const collection = await VectorStore.getCollectionUnsafe(Instance.directory, meta.embeddings?.dimension)
      await VectorStore.deleteByFile(collection, filePath)
    }

    delete meta.files[filePath]
    meta.updatedAt = Date.now()
    await VectorStore.writeIndexMeta(Instance.directory, meta)
  }

  async function buildDocuments(input: {
    filePath: string
    content: string
    chunks?: Chunking.Chunk[]
  }): Promise<Document[]> {
    const normalizedFilePath = normalizeIndexedFilePath(input.filePath)
    const chunks = input.chunks ?? await Chunking.chunkAsync(input.content, normalizedFilePath)
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
        ...(chunk.calls && { calls: chunk.calls }),
        // Multilingual support fields
        ...(chunk.variant && { variant: chunk.variant }),
        ...(chunk.isAsync !== undefined && { isAsync: chunk.isAsync }),
        ...(chunk.isStatic !== undefined && { isStatic: chunk.isStatic }),
        ...(chunk.isAbstract !== undefined && { isAbstract: chunk.isAbstract }),
        ...(chunk.decorators && chunk.decorators.length > 0 && { decorators: chunk.decorators.join(",") }),
      },
    }))
  }

  async function analyzeFile(filePath: string, content: string): Promise<{
    documents: Document[]
    collapsibleRegions: TreeShaker.CollapsibleRegion[]
  }> {
    const analysis = await Chunking.analyzeAsync(content, filePath)
    const documents = await buildDocuments({ filePath, content, chunks: analysis.chunks })
    return { documents, collapsibleRegions: analysis.collapsibleRegions }
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

  async function embedDocumentBatches(
    documents: Array<{ id: string; content: string; contentRaw: string; metadata: Record<string, string | number | boolean | null> }>,
    run: ReturnType<typeof createRunContext>,
    progress: Omit<IndexProgress, "phase" | "current" | "total" | "message" | "chunksEmbedded">,
    label: string,
  ): Promise<VectorStore.EmbeddedDocumentRow[]> {
    if (documents.length === 0) return []

    const batches: Array<{ start: number; batch: typeof documents }> = []
    for (let i = 0; i < documents.length; i += ADD_BATCH_SIZE) {
      batches.push({ start: i, batch: documents.slice(i, i + ADD_BATCH_SIZE) })
    }

    log.info("embedding document batches", {
      chunks: documents.length,
      batches: batches.length,
      batchSize: ADD_BATCH_SIZE,
      concurrency: EMBED_BATCH_CONCURRENCY,
      label,
    })

    let chunksEmbedded = 0
    const embeddedBatches = await mapConcurrent(batches, EMBED_BATCH_CONCURRENCY, async ({ start, batch }) => {
      run.assertNotTimedOut("embed")
      const rows = await run.withTimeout(VectorStore.embedDocuments(batch, { signal: run.signal }), "embed")
      chunksEmbedded += rows.length
      const labelPrefix = label ? `${label} ` : ""
      run.emit({
        phase: "embed",
        current: chunksEmbedded,
        total: documents.length,
        message: `Embedded ${labelPrefix}chunks ${start + 1}-${Math.min(start + batch.length, documents.length)} of ${documents.length}`,
        ...progress,
        chunksEmbedded,
      })
      return rows
    })

    return embeddedBatches.flat()
  }

  async function embedAndPersistDocumentBatches(
    documents: Array<{ id: string; content: string; contentRaw: string; metadata: Record<string, string | number | boolean | null> }>,
    collection: Awaited<ReturnType<typeof VectorStore.createStagingCollection>>["collection"],
    run: ReturnType<typeof createRunContext>,
    progress: { filesParsed: number; chunksPrepared: number; estimatedTokens?: number; requests?: number; failed: number },
  ): Promise<number> {
    const batches: typeof documents[] = []
    for (let i = 0; i < documents.length; i += ADD_BATCH_SIZE) {
      batches.push(documents.slice(i, i + ADD_BATCH_SIZE))
    }

    let chunksPersisted = 0
    for (let i = 0; i < batches.length; i += EMBED_BATCH_CONCURRENCY) {
      run.assertNotTimedOut("embed")
      const window = batches.slice(i, i + EMBED_BATCH_CONCURRENCY)
      const embeddedWindow = await Promise.all(window.map((batch) =>
        run.withTimeout(VectorStore.embedDocuments(batch, { signal: run.signal }), "embed")
      ))

      for (const rows of embeddedWindow) {
        run.emit({
          phase: "embed",
          current: chunksPersisted + rows.length,
          total: documents.length,
          message: `Embedded ${Math.min(chunksPersisted + rows.length, documents.length)}/${documents.length} chunks`,
          ...progress,
          chunksEmbedded: chunksPersisted + rows.length,
        })
        await VectorStore.addEmbeddedDocuments(collection, rows)
        run.assertNotTimedOut("persist")
        chunksPersisted += rows.length
        run.emit({
          phase: "persist",
          current: chunksPersisted,
          total: documents.length,
          message: `Persisted ${chunksPersisted}/${documents.length} chunks`,
          ...progress,
          chunksEmbedded: chunksPersisted,
          chunksPersisted,
        })
      }
    }
    return chunksPersisted
  }

  type PreparedFile = {
    file: string
    stat: { size: number; mtimeMs: number }
    hash: string
    collapsibleRegions: TreeShaker.CollapsibleRegion[]
    documents: Document[]
  }

  type ResumeState = { signature: string; tableName: string; updatedAt: number }

  function resumeStatePath(): string {
    const key = crypto.createHash("sha1").update(`${path.resolve(Instance.directory)}\0${Instance.profile}`).digest("hex")
    return path.join(Global.Path.data, "resume", `index-${key}.json`)
  }

  async function readResumeState(): Promise<ResumeState | null> {
    const raw = await fs.readFile(resumeStatePath(), "utf8").catch(() => null)
    if (!raw) return null
    try {
      const state = JSON.parse(raw) as ResumeState
      return state?.signature && state?.tableName ? state : null
    } catch {
      return null
    }
  }

  async function writeResumeState(state: ResumeState): Promise<void> {
    const target = resumeStatePath()
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, `${JSON.stringify(state, null, 2)}\n`, "utf8")
  }

  async function clearResumeState(): Promise<void> {
    await fs.rm(resumeStatePath(), { force: true }).catch(() => {})
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

      let files = await run.withTimeout(getFiles(run.signal), "scan")
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

          const { collapsibleRegions, documents } = await analyzeFile(file, content)

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

      run.assertNotTimedOut("persist")
      const config = Embeddings.getConfig()
      const resumeEnabled = options.resume !== false
      const signature = crypto.createHash("sha1").update(JSON.stringify({
        embeddings: embeddingConfigFingerprint(config),
        chunking: getChunkingSignature(config),
        files: Object.entries(fileStats)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([file, stat]) => [file, stat.hash]),
      })).digest("hex")
      const previousResume = resumeEnabled ? await readResumeState() : null
      if (previousResume && previousResume.signature !== signature) {
        await VectorStore.dropCollectionTable(Instance.directory, previousResume.tableName).catch(() => {})
        await clearResumeState()
      }
      const staging = previousResume?.signature === signature
        ? {
            collection: await VectorStore.openCollectionTable(Instance.directory, previousResume.tableName, config.embedDim),
            tableName: previousResume.tableName,
          }
        : await VectorStore.createStagingCollection(Instance.directory, config.embedDim)
      let activated = false
      let checkpointed = false

      try {
        if (resumeEnabled) {
          await writeResumeState({ signature, tableName: staging.tableName, updatedAt: Date.now() })
          checkpointed = true
        }
        const persistedIds = previousResume?.signature === signature
          ? new Set((await VectorStore.listDocuments(staging.collection, { columns: ["id"] })).map((row) => row.id))
          : new Set<string>()
        const pendingDocs = allDocs.filter((document) => !persistedIds.has(document.id))
        const estimatedTokens = allDocs.reduce((total, document) => total + estimateEmbeddingTokens(document.content), 0)
        const estimatedRequests = pendingDocs.length === 0 ? 0 : Math.ceil(pendingDocs.length / configBatchSize())
        if (persistedIds.size > 0) {
          run.emit({
            phase: "persist",
            current: persistedIds.size,
            total: allDocs.length,
            message: `Resuming full index with ${persistedIds.size}/${allDocs.length} chunks already persisted`,
            chunksPrepared: allDocs.length,
            chunksPersisted: persistedIds.size,
          })
        }
        await embedAndPersistDocumentBatches(pendingDocs, staging.collection, run, {
          filesParsed: indexed,
          chunksPrepared: totalChunks,
          estimatedTokens,
          requests: estimatedRequests,
          failed,
        })

        const finalStats = await VectorStore.getStats(staging.collection)
        if (finalStats.count !== allDocs.length) {
          throw new Error(
            `Staged index chunk mismatch: expected ${allDocs.length}, persisted ${finalStats.count}.`,
          )
        }
        await VectorStore.optimizeForSearch(staging.collection, finalStats.count)

        const chunking = getChunkingSignature(config)
        await VectorStore.writeIndexMeta(Instance.directory, {
          version: 1,
          root: Instance.directory,
          profile: Instance.profile,
          tableName: staging.tableName,
          embeddings: {
            provider: config.provider,
            model: config.embedModel,
            dimension: config.embedDim,
            distanceMetric: VectorStore.DEFAULT_DISTANCE_METRIC,
            configFingerprint: embeddingConfigFingerprint(config),
          },
          chunking,
          files: fileStats,
          updatedAt: Date.now(),
        })
        activated = true
        await clearResumeState()
        VectorStore.clearProjectCache(Instance.directory)
        await VectorStore.cleanupInactiveTables(Instance.directory, staging.tableName)
      } catch (error) {
        if (!activated && (!resumeEnabled || !checkpointed)) {
          await VectorStore.dropCollectionTable(Instance.directory, staging.tableName).catch(() => {})
        }
        throw error
      }

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
    } finally {
      run.dispose()
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
      let files = await run.withTimeout(getFiles(run.signal), "scan")
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
      const chunking = getChunkingSignature(config)

      if (
        !meta ||
        meta.embeddings?.dimension !== dimension ||
        meta.embeddings?.provider !== provider ||
        meta.embeddings?.model !== model ||
        (meta.embeddings?.configFingerprint !== undefined && meta.embeddings.configFingerprint !== embeddingConfigFingerprint(config)) ||
        meta.embeddings?.distanceMetric !== VectorStore.DEFAULT_DISTANCE_METRIC ||
        !sameChunkingSignature(meta.chunking, chunking)
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
          const { collapsibleRegions, documents } = await analyzeFile(file, content)

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
      const filesToReplace: string[] = []
      const filesToRemove: string[] = []
      const docsToAdd: { id: string; content: string; contentRaw: string; metadata: Record<string, string | number | boolean | null> }[] = []
      const documentsByFile = new Map<string, typeof docsToAdd>()

      for (const act of actions) {
        if (!act) continue

        remaining.delete(act.file)

        switch (act.action) {
          case "skip":
            skipped++
            newStats[act.file] = act.stats
            break

          case "delete":
            filesToRemove.push(act.file)
            break

          case "full_reindex":
            filesToReplace.push(act.file)
            {
              const fileDocuments = act.documents.map(({ id, content: docContent, contentRaw, metadata }) => ({
                id, content: docContent, contentRaw, metadata,
              }))
              documentsByFile.set(act.file, fileDocuments)
              docsToAdd.push(...fileDocuments)
            }
            indexed++
            totalChunks += act.documents.length
            newStats[act.file] = act.stats
            break
        }
      }

      // Reuse vectors for unchanged chunks inside changed files. New metadata is
      // materialized with the old vector; only genuinely new chunks hit the provider.
      let reusedChunks = 0
      let newlyEmbeddedChunks = 0
      const preparedReplacements = await mapConcurrent(
        filesToReplace,
        EMBED_BATCH_CONCURRENCY,
        async (file) => {
          run.assertNotTimedOut("embed")
          const prepared = await run.withTimeout(
            VectorStore.embedDocumentsReusingFile(collection, file, documentsByFile.get(file) ?? [], { signal: run.signal }),
            "embed",
          )
          reusedChunks += prepared.reused
          newlyEmbeddedChunks += prepared.embedded
          run.emit({
            phase: "embed",
            current: reusedChunks + newlyEmbeddedChunks,
            total: docsToAdd.length,
            message: `Prepared ${reusedChunks + newlyEmbeddedChunks}/${docsToAdd.length} changed chunks (${reusedChunks} reused)`,
            chunksPrepared: docsToAdd.length,
            chunksEmbedded: newlyEmbeddedChunks,
            reusedChunks,
            skipped,
            failed,
          })
          return { file, rows: prepared.rows }
        },
      )
      const embeddedRows = preparedReplacements.flatMap((prepared) => prepared.rows)
      const estimatedTokens = docsToAdd.reduce((total, document) => total + estimateEmbeddingTokens(document.content), 0)
      const estimatedRequests = newlyEmbeddedChunks === 0 ? 0 : Math.ceil(newlyEmbeddedChunks / configBatchSize())

      // Replace each changed file with rollback support. This keeps the previous
      // rows intact if a LanceDB append fails after deletion.
      if (embeddedRows.length > 0) {
        let chunksPersisted = 0
        for (const file of filesToReplace) {
          run.assertNotTimedOut("persist")
          const rows = embeddedRows.filter((row) => normalizeIndexedFilePath(row.file) === file)
          await VectorStore.replaceFileDocuments(collection, file, rows)
          run.assertNotTimedOut("persist")
          chunksPersisted += rows.length
          run.emit({
            phase: "persist",
            current: chunksPersisted,
            total: embeddedRows.length,
            message: `Persisted ${chunksPersisted}/${embeddedRows.length} changed chunks`,
            chunksPrepared: docsToAdd.length,
            chunksEmbedded: newlyEmbeddedChunks,
            reusedChunks,
            estimatedTokens,
            requests: estimatedRequests,
            chunksPersisted,
            skipped,
            failed,
          })
        }
      }

      for (const file of filesToRemove) {
        run.assertNotTimedOut("persist")
        await VectorStore.deleteByFile(collection, file)
        removed++
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
      await VectorStore.optimizeForSearch(collection, nextStats.count)

      await VectorStore.writeIndexMeta(Instance.directory, {
        version: 1,
        root: Instance.directory,
        profile: Instance.profile,
        tableName: meta.tableName,
        embeddings: {
          provider,
          model,
          dimension,
          distanceMetric: VectorStore.DEFAULT_DISTANCE_METRIC,
          configFingerprint: embeddingConfigFingerprint(config),
        },
        chunking,
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
        chunksEmbedded: newlyEmbeddedChunks,
        reusedChunks,
        estimatedTokens,
        requests: estimatedRequests,
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
    } finally {
      run.dispose()
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
  async function updateFileUnlocked(filePath: string): Promise<void> {
    filePath = normalizeIndexedFilePath(filePath)
    if (!shouldIndex(filePath)) {
      await deleteIndexedFileIfPresent(filePath)
      return
    }
    if (shouldIgnoreIndexedFile(Instance.directory, filePath)) {
      await deleteIndexedFileIfPresent(filePath)
      return
    }

    log.info("updating file in index", { file: filePath })

    const fullPath = path.join(Instance.directory, filePath)
    const stat = await fs.stat(fullPath).catch(() => null)
    if (!stat) {
      await deleteIndexedFileIfPresent(filePath)
      return
    }
    if (stat.size > MAX_FILE_SIZE) {
      await deleteIndexedFileIfPresent(filePath)
      return
    }

    const content = await fs.readFile(fullPath, "utf8").catch(() => "")
    if (isProbablyMinifiedOrGenerated(filePath, content)) {
      await deleteIndexedFileIfPresent(filePath)
      return
    }
    if (!content.trim()) {
      await deleteIndexedFileIfPresent(filePath)
      return
    }

    const { collapsibleRegions, documents } = await analyzeFile(filePath, content)
    if (documents.length === 0) {
      await deleteIndexedFileIfPresent(filePath)
      return
    }
    assertEmbeddingsConfigured()
    const collection = await VectorStore.getCollection(Instance.directory)
    const docsToAdd = documents.map(({ id, content: docContent, contentRaw, metadata }) => ({
      id,
      content: docContent,
      contentRaw,
      metadata,
    }))
    const prepared = await VectorStore.embedDocumentsReusingFile(collection, filePath, docsToAdd)
    await VectorStore.replaceFileDocuments(collection, filePath, prepared.rows)
    const meta = await VectorStore.readIndexMeta(Instance.directory)
    if (meta?.files) {
      meta.chunking = getChunkingSignature(Embeddings.getConfig())
      meta.files[filePath] = {
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        hash: hashContent(content),
        chunks: documents.map((d) => d.hash),
        collapsibleRegions,
      }
      meta.updatedAt = Date.now()
      await VectorStore.writeIndexMeta(Instance.directory, meta)
    }
  }

  export async function updateFile(filePath: string): Promise<void> {
    return withIndexLock({}, () => updateFileUnlocked(filePath))
  }

  /**
   * Remove file from index
   */
  export async function removeFile(filePath: string): Promise<void> {
    return withIndexLock({}, async () => {
      filePath = normalizeIndexedFilePath(filePath)
      log.info("removing file from index", { file: filePath })
      await deleteIndexedFileIfPresent(filePath)
    })
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
  export async function verifyIndex(options: { signal?: AbortSignal; contentHash?: boolean } = {}): Promise<{
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

    const files = await getFiles(options.signal)
    const previous = Object.fromEntries(scopedMetaEntries(meta, resolved.subdirPrefix)) as Record<string, FileStat>
    const remaining = new Set(Object.keys(previous))
    let changed = 0
    let missing = 0
    const changedFiles: string[] = []
    const missingFiles: string[] = []

    for (const file of files) {
      options.signal?.throwIfAborted()
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

      let fileChanged: boolean
      if (options.contentHash === false) {
        fileChanged = prev.size !== stat.size || prev.mtimeMs !== stat.mtimeMs
      } else {
        const content = await fs.readFile(fullPath, "utf8").catch(() => "")
        const hash = content.trim() ? hashContent(content) : ""
        fileChanged = !hash || prev.hash !== hash
      }
      if (fileChanged) {
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
