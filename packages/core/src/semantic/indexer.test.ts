import path from "node:path"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const TEST_DIR = path.join(process.cwd(), ".test-indexer")

const readIndexMeta = vi.fn()
const getCollection = vi.fn()
const getStats = vi.fn()
const getCollectionUnsafe = vi.fn()
const hasCollection = vi.fn()
const deleteByFile = vi.fn()
const embedDocuments = vi.fn()
const embedDocumentsReusingFile = vi.fn()
const addEmbeddedDocuments = vi.fn()
const replaceFileDocuments = vi.fn()
const updateDocuments = vi.fn()
const writeIndexMeta = vi.fn()
const deleteCollection = vi.fn()
const createStagingCollection = vi.fn()
const dropCollectionTable = vi.fn()
const cleanupInactiveTables = vi.fn()
const clearProjectCache = vi.fn()
const optimizeForSearch = vi.fn()
const files = vi.fn()
const getConfig = vi.fn()
const extractRegions = vi.fn()
const chunkAsync = vi.fn()
const analyzeAsync = vi.fn()
const addOverlap = vi.fn((chunks) => chunks)
const testChunkingSignature = {
  version: 2,
  provider: "openai",
  model: "test-model",
  dimension: 3,
  modelMaxTokens: 8192,
  usableModelTokens: 6963,
  maxChars: 8800,
  minChars: 200,
  overlapChars: 384,
  simpleChars: 7200,
  mediumChars: 4800,
  complexChars: 3200,
}

vi.mock("./lancedb.js", () => ({
  VectorStore: {
    readIndexMeta,
    getCollection,
    getCollectionUnsafe,
    getStats,
    hasCollection,
    deleteByFile,
    embedDocuments,
    embedDocumentsReusingFile,
    addEmbeddedDocuments,
    replaceFileDocuments,
    updateDocuments,
    writeIndexMeta,
    deleteCollection,
    createStagingCollection,
    dropCollectionTable,
    cleanupInactiveTables,
    clearProjectCache,
    optimizeForSearch,
  },
}))

vi.mock("./embeddings.js", () => ({
  Embeddings: {
    getConfig,
  },
}))

vi.mock("../file/ripgrep.js", () => ({
  Ripgrep: {
    files,
  },
}))

vi.mock("../project/instance.js", () => ({
  Instance: {
    directory: TEST_DIR,
    provide: async (input: { fn: () => unknown }) => input.fn(),
  },
}))

vi.mock("./tree-shaker.js", () => ({
  TreeShaker: {
    extractRegions,
  },
}))

vi.mock("./chunking.js", () => ({
  Chunking: {
    chunkAsync,
    analyzeAsync,
    addOverlap,
  },
}))

describe("Indexer incremental updates", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await rm(TEST_DIR, { recursive: true, force: true })
    await mkdir(path.join(TEST_DIR, "src"), { recursive: true })
    await writeFile(path.join(TEST_DIR, "src/a.ts"), "export const a = 2\n")

    getConfig.mockReturnValue({
      provider: "openai",
      embedModel: "test-model",
      embedDim: 3,
      apiKey: "test-key",
    })
    files.mockImplementation(async function* () {
      yield "src/a.ts"
    })
    readIndexMeta.mockResolvedValue({
      version: 1,
      root: TEST_DIR,
      embeddings: {
        provider: "openai",
        model: "test-model",
        dimension: 3,
      },
      chunking: testChunkingSignature,
      files: {
        "src/a.ts": {
          size: 1,
          mtimeMs: 1,
          hash: "old-hash",
          chunks: ["old-chunk-hash"],
        },
      },
      updatedAt: Date.now(),
    })
    getCollection.mockResolvedValue({})
    getCollectionUnsafe.mockResolvedValue({})
    hasCollection.mockResolvedValue(true)
    getStats.mockResolvedValue({ count: 1, name: "chunks" })
    createStagingCollection.mockResolvedValue({ collection: { staging: true }, tableName: "chunks_staging" })
    dropCollectionTable.mockResolvedValue(undefined)
    cleanupInactiveTables.mockResolvedValue(undefined)
    extractRegions.mockResolvedValue([])
    chunkAsync.mockResolvedValue([
      {
        content: "export const a = 2",
        startLine: 1,
        endLine: 1,
        type: "variable",
      },
    ])
    analyzeAsync.mockImplementation(async () => ({
      chunks: await chunkAsync(),
      collapsibleRegions: await extractRegions(),
    }))
    embedDocuments.mockImplementation(async (documents) =>
      documents.map((document: any) => ({
        id: document.id,
        content: document.content,
        content_raw: document.contentRaw,
        vector: [1, 0, 0],
        file: document.metadata.file,
        startLine: document.metadata.startLine,
        endLine: document.metadata.endLine,
        chunkIndex: document.metadata.chunkIndex,
        type: document.metadata.type,
        symbolName: "",
        symbolType: "",
        complexity: 0,
        isExported: false,
        parentScope: "",
        semanticKind: "",
        framework: "",
        scopeDepth: 0,
        hasDocumentation: false,
        language: "",
        imports: "",
        variant: "",
        isAsync: false,
        isStatic: false,
        isAbstract: false,
        decorators: "",
      })),
    )
    embedDocumentsReusingFile.mockImplementation(async (_collection, _file, documents) => {
      const rows = await embedDocuments(documents)
      return { rows, embedded: rows.length, reused: 0 }
    })
  })

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true })
  })

  it("reindexes changed files by file instead of partial chunk updates", async () => {
    const { Indexer } = await import("./indexer.js")

    const result = await Indexer.indexProjectIncremental()

    expect(result.mode).toBe("incremental")
    expect(result.files).toBe(1)
    expect(updateDocuments).not.toHaveBeenCalled()
    expect(embedDocumentsReusingFile).toHaveBeenCalledTimes(1)
    expect(embedDocuments).toHaveBeenCalledTimes(1)
    expect(replaceFileDocuments).toHaveBeenCalledWith({}, "src/a.ts", expect.any(Array))
    expect(writeIndexMeta).toHaveBeenCalledTimes(1)
    expect(writeIndexMeta.mock.calls[0][1].chunking).toEqual(testChunkingSignature)
  })

  it("plans embedding work without calling the provider or mutating the index", async () => {
    const { Indexer } = await import("./indexer.js")

    const plan = await Indexer.planIndex()

    expect(plan.mode).toBe("incremental")
    expect(plan.changed).toEqual(["src/a.ts"])
    expect(plan.chunks).toBe(1)
    expect(plan.estimatedTokens).toBeGreaterThan(0)
    expect(embedDocuments).not.toHaveBeenCalled()
    expect(embedDocumentsReusingFile).not.toHaveBeenCalled()
    expect(replaceFileDocuments).not.toHaveBeenCalled()
    expect(writeIndexMeta).not.toHaveBeenCalled()
  })

  it("updates collapsible regions during watched file updates", async () => {
    const regions = [
      {
        type: "function",
        name: "a",
        startLine: 1,
        endLine: 1,
        signatureEndLine: 1,
        indentation: "",
      },
    ]
    extractRegions.mockResolvedValueOnce(regions)
    const { Indexer } = await import("./indexer.js")

    await Indexer.updateFile("src/a.ts")

    expect(embedDocumentsReusingFile).toHaveBeenCalledTimes(1)
    expect(embedDocuments).toHaveBeenCalledTimes(1)
    expect(replaceFileDocuments).toHaveBeenCalledWith({}, "src/a.ts", expect.any(Array))
    expect(writeIndexMeta).toHaveBeenCalledTimes(1)
    expect(writeIndexMeta.mock.calls[0][1].files["src/a.ts"].collapsibleRegions).toEqual(regions)
    expect(writeIndexMeta.mock.calls[0][1].chunking).toEqual(testChunkingSignature)
  })

  it("removes generated files from index metadata during file updates", async () => {
    await writeFile(path.join(TEST_DIR, "src/a.ts"), "x".repeat(60_000))
    const { Indexer } = await import("./indexer.js")

    await Indexer.updateFile("src/a.ts")

    expect(deleteByFile).toHaveBeenCalledWith({}, "src/a.ts")
    expect(embedDocuments).not.toHaveBeenCalled()
    expect(embedDocumentsReusingFile).not.toHaveBeenCalled()
    expect(writeIndexMeta).toHaveBeenCalledTimes(1)
    expect(writeIndexMeta.mock.calls[0][1].files["src/a.ts"]).toBeUndefined()
  })

  it("removes stale metadata when a watched file is no longer indexable", async () => {
    readIndexMeta.mockResolvedValueOnce({
      version: 1,
      root: TEST_DIR,
      embeddings: {
        provider: "openai",
        model: "test-model",
        dimension: 3,
      },
      chunking: testChunkingSignature,
      files: {
        "src/a.ts.map": {
          size: 1,
          mtimeMs: 1,
          hash: "old-hash",
          chunks: ["old-chunk-hash"],
        },
      },
      updatedAt: Date.now(),
    })
    const { Indexer } = await import("./indexer.js")

    await Indexer.updateFile("src/a.ts.map")

    expect(deleteByFile).toHaveBeenCalledWith({}, "src/a.ts.map")
    expect(embedDocuments).not.toHaveBeenCalled()
    expect(embedDocumentsReusingFile).not.toHaveBeenCalled()
    expect(getConfig).not.toHaveBeenCalled()
    expect(writeIndexMeta).toHaveBeenCalledTimes(1)
    expect(writeIndexMeta.mock.calls[0][1].files["src/a.ts.map"]).toBeUndefined()
  })

  it("serializes concurrent indexing for the same project", async () => {
    let activeReads = 0
    let maxActiveReads = 0
    let readCount = 0
    let firstReadStarted!: () => void
    let releaseFirstRead!: () => void
    const firstReadStartedPromise = new Promise<void>((resolve) => { firstReadStarted = resolve })
    const releaseFirstReadPromise = new Promise<void>((resolve) => { releaseFirstRead = resolve })
    const meta = await readIndexMeta()
    readIndexMeta.mockImplementation(async () => {
      activeReads++
      maxActiveReads = Math.max(maxActiveReads, activeReads)
      readCount++
      if (readCount === 1) {
        firstReadStarted()
        await releaseFirstReadPromise
      }
      activeReads--
      return meta
    })
    const { Indexer } = await import("./indexer.js")

    const first = Indexer.indexProjectIncremental()
    await firstReadStartedPromise
    const second = Indexer.indexProjectIncremental()
    await new Promise((resolve) => setTimeout(resolve, 10))
    releaseFirstRead()
    await Promise.all([first, second])

    expect(maxActiveReads).toBe(1)
  })

  it("keeps the active index metadata when staged persistence fails", async () => {
    addEmbeddedDocuments.mockRejectedValueOnce(new Error("disk full"))
    const { Indexer } = await import("./indexer.js")

    await expect(Indexer.indexProject({ resume: false })).rejects.toThrow("disk full")

    expect(deleteCollection).not.toHaveBeenCalled()
    expect(writeIndexMeta).not.toHaveBeenCalled()
    expect(dropCollectionTable).toHaveBeenCalledWith(TEST_DIR, "chunks_staging")
  })
})
