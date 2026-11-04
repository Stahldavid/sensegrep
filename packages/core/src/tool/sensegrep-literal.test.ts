import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ directory: "/repo", scannedDirectory: "", sourceHash: "a".repeat(64) }))
const readProjectSource = vi.fn(async () => ({ rawSha256: state.sourceHash, lines: ["const header = 'X-Test'"] }))
vi.mock("../file/source-reader.js", () => ({ readProjectSource }))

vi.mock("../semantic/generation-leases.js", () => ({ GenerationLeases: class { async acquire() { return async () => {} } } }))

const getCollectionUnsafe = vi.fn(async () => ({}))
const openCollectionReadOnly = vi.fn(async () => ({}))
const listDocuments = vi.fn(async () => [{
  id: "src/a.ts:0",
  content: "const header = 'X-Test'",
  metadata: { file: "src/a.ts", startLine: 1, endLine: 3, symbolName: "header", symbolType: "variable" },
}])
const runRipgrepOnFiles = vi.fn(async () => { state.scannedDirectory = state.directory; return [
  { file: "src/a.ts", line: 1, text: "const header = 'X-Test'" },
  { file: "src/b.ts", line: 4, text: "response.set('X-Test')" },
] })

vi.mock("../semantic/lancedb.js", () => ({
  VectorStore: {
    getIndexStoragePath: () => "/mock-index",
    resolveIndexedProject: async () => ({
      root: "/repo",
      meta: { embeddings: { dimension: 3 }, files: { "src/a.ts": { sourceHashKind: "sha256-raw-v1", sourceSha256: "a".repeat(64) }, "src/b.ts": {} } },
    }),
    getCollectionUnsafe,
    inspectCollectionSchema: async () => ({ exists: true, schemaCompatible: true, tableName: "chunks", missingFields: [] }),
    openCollectionReadOnly,
    listDocuments,
  },
}))
vi.mock("../project/instance.js", () => ({ Instance: {
  get directory() { return state.directory }, profile: "alpha",
  async provide({ directory, fn }: any) { const previous = state.directory; state.directory = directory; try { return await fn() } finally { state.directory = previous } },
} }))
vi.mock("./sensegrep-pipeline.js", () => ({
  canonicalizeProjectFilePath: (file: string) => file.replace(/\\/g, "/"),
  createGlobMatcher: () => () => true,
  getScopedFilePath: (file: string) => file,
  matchesScopedGlob: () => true,
  pickBestLiteralDocument: (documents: any[]) => documents[0],
  runRipgrepOnFiles,
}))

describe("SenseGrepLiteralTool", () => {
  beforeEach(() => { vi.clearAllMocks(); state.directory = "/repo"; state.sourceHash = "a".repeat(64) })

  it("scans from the parent index root and preserves the caller context", async () => {
    state.directory = "/repo/child"
    const { SenseGrepLiteralTool } = await import("./sensegrep-literal.js")
    const tool = await SenseGrepLiteralTool.init()
    await tool.execute({ query: "X-Test" }, { abort: new AbortController().signal } as any)
    expect(state.scannedDirectory).toBe("/repo")
    expect(state.directory).toBe("/repo/child")
  })

  it("does not attach indexed symbols to content with a divergent strong hash", async () => {
    state.sourceHash = "b".repeat(64)
    const { SenseGrepLiteralTool } = await import("./sensegrep-literal.js")
    const tool = await SenseGrepLiteralTool.init()
    const result = await tool.execute({ query: "X-Test" }, { abort: new AbortController().signal } as any)
    expect(result.index).toMatchObject({ fresh: false })
    expect(result.matches?.[0]).not.toHaveProperty("symbolName")
    expect(listDocuments).not.toHaveBeenCalled()
  })

  it("reports exhaustive occurrence counts and explicit truncation without embeddings", async () => {
    const { SenseGrepLiteralTool } = await import("./sensegrep-literal.js")
    const tool = await SenseGrepLiteralTool.init()
    const result = await tool.execute({ query: "X-Test", limit: 1, regex: false, caseSensitive: true }, {
      sessionID: "test",
      messageID: "test",
      agent: "vitest",
      abort: new AbortController().signal,
      metadata() {},
    })

    expect(result.metadata).toMatchObject({ totalMatches: 2, returnedMatches: 1, truncated: true, exhaustive: false })
    expect(result.matches).toHaveLength(1)
    expect(runRipgrepOnFiles).toHaveBeenCalledWith("X-Test", ["src/a.ts", "src/b.ts"], expect.objectContaining({ fixedStrings: true }))
    expect(openCollectionReadOnly).toHaveBeenCalledTimes(1)
  })
})
