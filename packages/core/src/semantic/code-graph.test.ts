import { beforeEach, describe, expect, it, vi } from "vitest"

const listDocuments = vi.fn()

vi.mock("./lancedb.js", () => ({
  VectorStore: {
    resolveIndexedProject: async () => ({
      root: "/repo",
      meta: { embeddings: { provider: "openai", dimension: 3 } },
    }),
    getCollectionUnsafe: async () => ({}),
    openCollectionReadOnly: async () => ({}),
    inspectCollectionSchema: async () => ({ schemaCompatible: true, fields: ["calls", "imports"] }),
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
  it("classifies only scheduler targets, ignoring comments and strings", async () => {
    listDocuments.mockResolvedValue([
      row("run", 'validate(); ctx.scheduler.runAfter(0, internal.jobs.deliver, {}); // cron validate()\nconst note = "scheduler validate()";', 1),
      row("validate", "return true", 20), row("deliver", "return true", 30),
    ])
    const { CodeGraph } = await import("./code-graph.js")
    expect((await CodeGraph.findReferences("validate")).references.map((r) => r.kind)).toEqual(["call"])
    expect((await CodeGraph.findReferences("deliver")).references.map((r) => r.kind)).toEqual(["scheduled-function"])
  })

  it("deduplicates overlapping chunks but retains genuine direct and scheduled edges", async () => {
    const source = 'deliver(); ctx.scheduler.runAfter(0, deliver, {})'
    listDocuments.mockResolvedValue([row("run", source, 1), row("run", source, 2), row("deliver", "return true", 30)])
    const { CodeGraph } = await import("./code-graph.js")
    expect((await CodeGraph.findReferences("deliver")).references.map((r) => r.kind).sort()).toEqual(["call", "scheduled-function"])
  })

  it("resolves named import aliases without binding an unrelated same-name symbol", async () => {
    listDocuments.mockResolvedValue([
      row("run", 'import { validate as check } from "./rules"; check()', 1),
      { ...row("validate", "return true", 20), metadata: { ...row("validate", "", 20).metadata, file: "src/rules.ts" } },
      { ...row("validate", "return false", 20), metadata: { ...row("validate", "", 20).metadata, file: "src/other.ts" } },
    ])
    const { CodeGraph } = await import("./code-graph.js")
    const references = (await CodeGraph.findReferences("validate")).references
    expect(references).toHaveLength(1)
    expect(references[0].targetLocation.file).toBe("src/rules.ts")
  })

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
    expect(impact.impacted).toMatchObject([
      { symbol: "loadUser", depth: 1 },
      { symbol: "handleRequest", depth: 2 },
    ])
    expect(trace).toMatchObject({ found: true, path: ["handleRequest", "loadUser", "fetchUser"] })
  })

  it("does not connect ambiguous call targets that only share a symbol name", async () => {
    listDocuments.mockResolvedValue([
      { content: "create()", metadata: { file: "src/caller.ts", startLine: 1, endLine: 2, symbolName: "run", calls: "create" } },
      { content: "", metadata: { file: "src/users.ts", startLine: 1, endLine: 2, symbolName: "create" } },
      { content: "", metadata: { file: "src/orders.ts", startLine: 1, endLine: 2, symbolName: "create" } },
    ])
    const { CodeGraph } = await import("./code-graph.js")

    const impact = await CodeGraph.impact("create")

    expect(impact.definitions).toHaveLength(2)
    expect(impact.impacted).toEqual([])
    expect(impact.ambiguous).toBe(true)
  })

  it("emits inheritance, import, and schema-table edges with coverage metrics", async () => {
    listDocuments.mockResolvedValue([
      { content: "class Child extends Parent { run() { return db.query('users') } }", metadata: { file: "src/app.ts", startLine: 1, endLine: 3, symbolName: "Child", imports: "convex/server" } },
      { content: "class Parent {}", metadata: { file: "src/base.ts", startLine: 1, endLine: 1, symbolName: "Parent" } },
    ])
    const { CodeGraph } = await import("./code-graph.js")
    const graph = await CodeGraph.build()
    expect(graph.references.map((reference) => reference.kind)).toEqual(expect.arrayContaining(["inheritance", "import", "schema-table"]))
    expect(graph.metrics.resolvedEdges).toBeGreaterThanOrEqual(3)
  })

  it("merges adjacent chunks from the same logical symbol", async () => {
    listDocuments.mockResolvedValue([
      { id: "caller", content: "return _generateToken()", metadata: { file: "src/auth.ts", startLine: 20, endLine: 30, symbolName: "login", calls: "_generateToken" } },
      { id: "token:0", content: "function _generateToken() {", metadata: { file: "src/auth.ts", startLine: 130, endLine: 268, symbolName: "_generateToken", parentScope: "Auth" } },
      { id: "token:1", content: "return token }", metadata: { file: "src/auth.ts", startLine: 269, endLine: 310, symbolName: "_generateToken", parentScope: "Auth" } },
    ])
    const { CodeGraph } = await import("./code-graph.js")

    const references = await CodeGraph.findReferences("_generateToken")

    expect(references.definitions).toHaveLength(1)
    expect(references.definitions[0]).toMatchObject({ startLine: 130, endLine: 310 })
    expect(references.references).toHaveLength(1)
  })
})
