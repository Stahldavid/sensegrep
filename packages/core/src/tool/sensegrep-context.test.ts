import { beforeEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

let directory = ""

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
        status: "complete",
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
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "sensegrep-audit-budget-"))
    await Promise.all(["a.ts", "b.ts", "c.ts"].map((file) => fs.writeFile(path.join(directory, file), "x".repeat(800))))
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
    expect(result.coverage).toMatchObject({ exhaustive: false, truncationReasons: ["max-batches"] })
  })
})
