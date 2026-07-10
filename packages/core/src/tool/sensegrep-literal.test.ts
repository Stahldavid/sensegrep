import { beforeEach, describe, expect, it, vi } from "vitest"

const getCollectionUnsafe = vi.fn(async () => ({}))
const openCollectionReadOnly = vi.fn(async () => ({}))
const listDocuments = vi.fn(async () => [{
  id: "src/a.ts:0",
  content: "const header = 'X-Test'",
  metadata: { file: "src/a.ts", startLine: 1, endLine: 3, symbolName: "header", symbolType: "variable" },
}])
const runRipgrepOnFiles = vi.fn(async () => [
  { file: "src/a.ts", line: 1, text: "const header = 'X-Test'" },
  { file: "src/b.ts", line: 4, text: "response.set('X-Test')" },
])

vi.mock("../semantic/lancedb.js", () => ({
  VectorStore: {
    resolveIndexedProject: async () => ({
      root: "/repo",
      meta: { embeddings: { dimension: 3 }, files: { "src/a.ts": {}, "src/b.ts": {} } },
    }),
    getCollectionUnsafe,
    inspectCollectionSchema: async () => ({ exists: true, schemaCompatible: true, tableName: "chunks", missingFields: [] }),
    openCollectionReadOnly,
    listDocuments,
  },
}))
vi.mock("../project/instance.js", () => ({ Instance: { directory: "/repo" } }))
vi.mock("./sensegrep-pipeline.js", () => ({
  canonicalizeProjectFilePath: (file: string) => file.replace(/\\/g, "/"),
  createGlobMatcher: () => () => true,
  getScopedFilePath: (file: string) => file,
  matchesScopedGlob: () => true,
  pickBestLiteralDocument: (documents: any[]) => documents[0],
  runRipgrepOnFiles,
}))

describe("SenseGrepLiteralTool", () => {
  beforeEach(() => vi.clearAllMocks())

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
