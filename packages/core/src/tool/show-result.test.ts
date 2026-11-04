import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createResultId } from "./result-id.js"
import { sourceContentHash } from "../file/source-reader.js"
import { Instance } from "../project/instance.js"
import { runShowResult } from "./show-result.js"

const findReferences = vi.fn(async () => [])
const impact = vi.fn(async () => [])
vi.mock("../semantic/code-graph.js", () => ({ CodeGraph: { findReferences, impact } }))
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); vi.clearAllMocks() })
async function rootWith(content: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), "sensegrep-show-"))
  roots.push(root)
  await writeFile(path.join(root, "a.ts"), content)
  return root
}

describe("live result identity", () => {
  it("reports stale target content and unknown legacy provenance", async () => {
    const root = await rootWith("new content\n")
    const location = { file: "a.ts", startLine: 1, endLine: 1 }
    const stale = await runShowResult({ rootDir: root, resultId: createResultId({ ...location, sourceHash: sourceContentHash("old content") }) })
    expect(stale.freshness.targetFresh).toBe(false)
    expect(stale.result.snippetIntegrity).toBe("stale-location")
    const legacy = await runShowResult({ rootDir: root, resultId: createResultId(location) })
    expect(legacy.freshness.targetFresh).toBeNull()
    expect(legacy.result.snippetIntegrity).toBe("unknown")
  })

  it("does not attach graph results to an unverified or stale target", async () => {
    const root = await rootWith("current\n")
    const { SenseGrepShowTool } = await import("./sensegrep-show.js")
    const tool = await SenseGrepShowTool.init()
    const ctx = { sessionID: "s", messageID: "m", agent: "test", abort: new AbortController().signal, metadata() {} }
    const target = { file: "a.ts", startLine: 1, endLine: 1, symbol: "x" }
    for (const sourceHash of [undefined, sourceContentHash("old")]) {
      const result = await Instance.provide({ directory: root, fn: () => tool.execute({ resultId: createResultId({ ...target, sourceHash }), expand: true } as any, ctx) })
      expect(result.graphStatus).toBe("unavailable")
      expect(result.graph).toBeUndefined()
    }
    expect(findReferences).not.toHaveBeenCalled()
    expect(impact).not.toHaveBeenCalled()
    const verified = await Instance.provide({ directory: root, fn: () => tool.execute({ resultId: createResultId({ ...target, sourceHash: sourceContentHash("current") }), expand: true } as any, ctx) })
    expect(verified.graph).toBeDefined()
    expect(verified.graphStatus).toBe("index-freshness-unverified")
    expect(findReferences).toHaveBeenCalledTimes(1)
  })
})
