import { beforeEach, describe, expect, it, vi } from "vitest"

const listDocuments = vi.fn()

vi.mock("./lancedb.js", () => ({
  VectorStore: {
    resolveIndexedProject: async () => ({
      root: "/repo",
      meta: { embeddings: { provider: "openai", dimension: 3 } },
    }),
    getCollectionUnsafe: async () => ({}),
    listDocuments,
  },
}))

vi.mock("../project/instance.js", () => ({ Instance: { directory: "/repo" } }))

function row(symbolName: string, content: string, startLine: number) {
  return {
    content,
    metadata: { file: "src/app.ts", startLine, endLine: startLine + 2, symbolName },
  }
}

describe("CodeGraph", () => {
  beforeEach(() => {
    listDocuments.mockResolvedValue([
      row("handleRequest", "return loadUser(id)", 1),
      row("loadUser", "return fetchUser(id)", 10),
      row("fetchUser", "return client.get(id)", 20),
    ])
  })

  it("finds references, transitive impact, and paths", async () => {
    const { CodeGraph } = await import("./code-graph.js")

    const references = await CodeGraph.findReferences("loadUser")
    const impact = await CodeGraph.impact("fetchUser")
    const trace = await CodeGraph.trace("handleRequest", "fetchUser")

    expect(references.references).toMatchObject([{ from: "handleRequest", to: "loadUser" }])
    expect(impact.impacted).toEqual([
      { symbol: "loadUser", depth: 1 },
      { symbol: "handleRequest", depth: 2 },
    ])
    expect(trace).toMatchObject({ found: true, path: ["handleRequest", "loadUser", "fetchUser"] })
  })
})
