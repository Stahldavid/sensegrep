import { beforeEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { decodeResultId } from "./result-id.js"
import { sourceContentHash } from "../file/source-reader.js"

let directory = ""
let searchStatus = "complete"

vi.mock("../project/instance.js", () => ({
  Instance: { get directory() { return directory } },
}))
vi.mock("../project/git.js", () => ({
  GitScope: { changedFiles: vi.fn(async () => ["a.ts", "b.ts", "c.ts"]) },
}))
vi.mock("./sensegrep.js", () => ({
  SenseGrepTool: {
    init: async () => ({
      execute: async () => ({
        schemaVersion: 1,
        command: "audit",
        status: searchStatus,
        title: "audit",
        metadata: {},
        results: [],
        budget: { tokensUsed: 20 },
        output: "initial",
      }),
    }),
  },
}))

describe("SenseGrepContextTool audit budgets", () => {
  beforeEach(async () => {
    searchStatus = "complete";
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "sensegrep-audit-budget-"))
    await Promise.all(["a.ts", "b.ts", "c.ts"].map((file) => fs.writeFile(path.join(directory, file), "x".repeat(800))))
  })

  it("binds complete line ranges but not partial lines to a source hash", async () => {
    await fs.writeFile(path.join(directory, "a.ts"), "alpha\nbeta\n")
    await fs.writeFile(path.join(directory, "b.ts"), "x".repeat(3000))
    const { SenseGrepContextTool } = await import("./sensegrep-context.js")
    const tool = await SenseGrepContextTool.init()
    const result = await tool.execute({ query: "review", gitChanged: true, continueUncovered: true,
      batchTokens: 100, maxTotalTokens: 10000, maxOutputBytes: 100000, maxBatches: 100, resultDetail: "content" } as any,
      { sessionID: "s", messageID: "m", agent: "test", abort: new AbortController().signal, metadata() {} }) as any
    const complete = result.results.find((entry: any) => entry.file === "a.ts")
    expect(decodeResultId(complete.resultId).sourceHash).toBe(sourceContentHash("alpha\nbeta"))
    const partial = result.results.filter((entry: any) => entry.file === "b.ts")
    expect(partial.length).toBeGreaterThan(1)
    expect(partial.every((entry: any) => decodeResultId(entry.resultId).sourceHash === undefined)).toBe(true)
  })

  it("keeps missing files uncovered instead of treating read errors as empty files", async () => {
    await fs.unlink(path.join(directory,"b.ts"))
    const {SenseGrepContextTool}=await import("./sensegrep-context.js")
    const tool=await SenseGrepContextTool.init()
    const result=await tool.execute({query:"review",gitChanged:true,continueUncovered:true,requireCoverage:true,
      maxTotalTokens:20000,maxOutputBytes:100000,resultDetail:"content"} as any,
      {sessionID:"test",messageID:"test",agent:"test",abort:new AbortController().signal,metadata(){}}) as any
    expect(result.coverage.uncoveredFiles).toContain("b.ts")
    expect(result.coverage.unreadableFiles).toContainEqual({file:"b.ts",reason:"ENOENT"})
    expect(result.coverage.unit).toBe("file-representation")
    expect(result.coverage.hunkCoverage).toBe("not-assessed")
    expect(result.coverageSatisfied).toBe(false)
    expect(result.status).toBe("incomplete")
  })

  it("bounds continuation batches globally and emits compact cards", async () => {
    const { SenseGrepContextTool } = await import("./sensegrep-context.js")
    const tool = await SenseGrepContextTool.init()
    const result = await tool.execute({
      query: "review",
      gitChanged: true,
      continueUncovered: true,
      requireCoverage: true,
      batchTokens: 1_000,
      maxTotalTokens: 500,
      maxOutputBytes: 2_000,
      maxBatches: 2,
      resultDetail: "compact",
    } as any, {
      sessionID: "test",
      messageID: "test",
      agent: "vitest",
      abort: new AbortController().signal,
      metadata() {},
    }) as any

    expect(result.batches.length).toBeLessThanOrEqual(2)
    expect(result.batches.flatMap((batch: any) => batch.resultIds).every((id: unknown) => typeof id === "string")).toBe(true)
    expect(result.results.every((entry: any) => entry.content === undefined)).toBe(true)
    expect(result.budget.emittedTokens).toBeLessThanOrEqual(500)
    expect(result.budget.outputBytes).toBeLessThanOrEqual(2_000)
    expect(result.coverage.exhaustive).toBe(false)
    expect(result.coverage.truncated).toBe(true)
  })

  it("splits large files so every continuation batch respects batchTokens", async () => {
    await Promise.all(["a.ts", "b.ts", "c.ts"].map((file) => fs.writeFile(
      path.join(directory, file),
      Array.from({ length: 250 }, (_, index) => `export const value${index} = "${"x".repeat(24)}"`).join("\n"),
    )))
    const { SenseGrepContextTool } = await import("./sensegrep-context.js")
    const tool = await SenseGrepContextTool.init()
    const result = await tool.execute({
      query: "review",
      gitChanged: true,
      continueUncovered: true,
      batchTokens: 1_000,
      maxTotalTokens: 20_000,
      maxOutputBytes: 100_000,
      maxBatches: 20,
      resultDetail: "compact",
    } as any, {
      sessionID: "test",
      messageID: "test",
      agent: "vitest",
      abort: new AbortController().signal,
      metadata() {},
    }) as any

    expect(result.results.length).toBeGreaterThan(3)
    expect(result.batches.every((batch: any) => batch.tokens <= 1_000)).toBe(true)
    expect(result.results.every((entry: any) => entry.estimatedTokens <= 1_000)).toBe(true)
    expect(result.coverage.exhaustive).toBe(true)
  })

  it("stops at exactly maxBatches while preserving strict batch sizes", async () => {
    await Promise.all(["a.ts", "b.ts", "c.ts"].map((file) => fs.writeFile(
      path.join(directory, file),
      Array.from({ length: 250 }, (_, index) => `export const value${index} = "${"x".repeat(24)}"`).join("\n"),
    )))
    const { SenseGrepContextTool } = await import("./sensegrep-context.js")
    const tool = await SenseGrepContextTool.init()
    const result = await tool.execute({
      query: "review",
      gitChanged: true,
      continueUncovered: true,
      requireCoverage: true,
      batchTokens: 1_000,
      maxTotalTokens: 20_000,
      maxOutputBytes: 100_000,
      maxBatches: 3,
      resultDetail: "compact",
    } as any, {
      sessionID: "test",
      messageID: "test",
      agent: "vitest",
      abort: new AbortController().signal,
      metadata() {},
    }) as any

    expect(result.batches).toHaveLength(3)
    expect(result.batches.every((batch: any) => batch.tokens <= 1_000)).toBe(true)
    expect(result.batches.flatMap((batch: any) => batch.ranges)).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: "a.ts", startLine: 1, startOffset: 0, estimatedTokens: expect.any(Number) }),
    ]))
    expect(result.coverage).toMatchObject({ exhaustive: false, truncationReasons: ["max-batches"] })
  })
})

describe("context prerequisite preservation",()=>{
  it.each(["index-required","migration-required","incompatible-embedding-config"])("preserves %s",async status=>{
    searchStatus=status
    const {SenseGrepContextTool}=await import("./sensegrep-context.js")
    const tool=await SenseGrepContextTool.init()
    const result=await tool.execute({query:"rule"} as any,{sessionID:"test",messageID:"test",agent:"test",abort:new AbortController().signal,metadata(){}})
    expect(result.status).toBe(status)
  })
})
