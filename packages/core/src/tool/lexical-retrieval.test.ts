import { EventEmitter } from "node:events"
import { describe, expect, it, vi } from "vitest"

vi.mock("../project/instance.js", () => ({ Instance: { directory: "/repo" } }))
vi.mock("../file/ripgrep.js", () => ({ Ripgrep: { filepath: async () => "rg" } }))
vi.mock("node:child_process", () => ({
  spawn: (_command: string, args: string[]) => {
    const proc = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() })
    queueMicrotask(() => {
      const files = args.slice(args.indexOf("--") + 1)
      proc.stdout.emit("data", files.flatMap((file) => Array.from({ length: 5 }, (_, i) =>
        `${file}:${i + 1}:${file === "z/rules.ts" ? "validate acceptedAt consent" : "patient consent page"}`,
      )).join("\n") + "\n")
      proc.emit("close", 0)
    })
    return proc
  },
}))
const files = [...Array.from({ length: 300 }, (_, i) => `a/page-${i}.ts`), "z/rules.ts"]
vi.mock("../semantic/lancedb.js", () => ({ VectorStore: {
  listDocuments: async () => files.map((file) => ({
    id: file,
    content: file === "z/rules.ts" ? "validate acceptedAt consent" : "patient consent page",
    metadata: { file, startLine: 1, endLine: 5, symbolName: file === "z/rules.ts" ? "validateConsent" : "Page", symbolType: "function" },
  })),
} }))

describe("lexical candidate coverage", () => {
  it("reaches later file batches despite many early common-term matches", async () => {
    const { collectLexicalQueryResults } = await import("./sensegrep-pipeline.js")
    const results = await collectLexicalQueryResults("patient consent acceptedAt", files, {} as any, {}, { limit: 5 })
    expect(results[0].file).toBe("z/rules.ts")
    expect(results).toHaveLength(5)
  })
})
