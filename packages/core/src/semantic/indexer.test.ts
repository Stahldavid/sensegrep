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
const addEmbeddedDocuments = vi.fn()
const updateDocuments = vi.fn()
const writeIndexMeta = vi.fn()
const deleteCollection = vi.fn()
const files = vi.fn()
const getConfig = vi.fn()
const extractRegions = vi.fn()
const chunkAsync = vi.fn()
const addOverlap = vi.fn((chunks) => chunks)

vi.mock("./lancedb.js", () => ({
  VectorStore: {
    readIndexMeta,
    getCollection,
    getCollectionUnsafe,
    getStats,
    hasCollection,
    deleteByFile,
    embedDocuments,
    addEmbeddedDocuments,
    updateDocuments,
    writeIndexMeta,
    deleteCollection,
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
    extractRegions.mockResolvedValue([])
    chunkAsync.mockResolvedValue([
      {
        content: "export const a = 2",
        startLine: 1,
        endLine: 1,
        type: "variable",
      },
    ])
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
    expect(embedDocuments).toHaveBeenCalledTimes(1)
    expect(deleteByFile).toHaveBeenCalledWith({}, "src/a.ts")
    expect(addEmbeddedDocuments).toHaveBeenCalledTimes(1)
    expect(writeIndexMeta).toHaveBeenCalledTimes(1)
  })

  it("removes generated files from index metadata during file updates", async () => {
    await writeFile(path.join(TEST_DIR, "src/a.ts"), "x".repeat(60_000))
    const { Indexer } = await import("./indexer.js")

    await Indexer.updateFile("src/a.ts")

    expect(deleteByFile).toHaveBeenCalledWith({}, "src/a.ts")
    expect(embedDocuments).not.toHaveBeenCalled()
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
    expect(getConfig).not.toHaveBeenCalled()
    expect(writeIndexMeta).toHaveBeenCalledTimes(1)
    expect(writeIndexMeta.mock.calls[0][1].files["src/a.ts.map"]).toBeUndefined()
  })
})
