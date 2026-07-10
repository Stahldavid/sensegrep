import { describe, expect, it } from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  annotateWorkingResults,
  fuseHybridResults,
  getDominantSymbolPhrases,
  matchesStrictStructuralFilters,
  parseRequestedImportModules,
  rerankWorkingResults,
  reconstructSymbolResults,
  selectWithinTokenBudget,
  decodeResultId,
  toStructuredSearchResult,
} from "./sensegrep-pipeline.js"

describe("sensegrep pipeline result metadata", () => {
  it("matches strict imports by complete normalized module specifier", () => {
    const result = {
      metadata: { imports: "convex/react,react,@clerk/nextjs/server" },
    } as any

    expect(matchesStrictStructuralFilters(result, { imports: "convex/react", strictImports: true })).toBe(true)
    expect(matchesStrictStructuralFilters(result, { imports: "convex", strictImports: true })).toBe(false)
    expect(matchesStrictStructuralFilters({ metadata: { imports: "react" } } as any, {
      imports: "convex/react",
      strictImports: true,
    })).toBe(false)
    expect(parseRequestedImportModules("'convex/react', @clerk\\nextjs\\server")).toEqual([
      "convex/react",
      "@clerk/nextjs/server",
    ])
  })

  it("raises confidence for exact symbol matches even with weak embedding scores", () => {
    const [result] = annotateWorkingResults(
      [
        {
          file: "convex/model/notification_delivery.ts",
          content: "export async function recordEmailFailure() {}",
          startLine: 1,
          endLine: 3,
          semanticScore: -0.2,
          metadata: {
            symbolName: "recordEmailFailure",
            symbolType: "function",
            language: "typescript",
          },
        },
      ],
      {
        query: "email failure telemetry",
        symbol: "recordEmailFailure",
      },
    )

    expect(result.confidence).toBe("high")
    expect(result.isWeakMatch).toBe(false)
    expect(result.whyMatched).toEqual(expect.arrayContaining(["symbol name matched: recordEmailFailure"]))
    expect(result.filterMatches?.symbol).toMatchObject({
      matched: true,
      mode: "metadata",
      value: "recordEmailFailure",
    })
  })

  it("derives readable dominant symbol phrases for thematic titles", () => {
    const phrases = getDominantSymbolPhrases(
      [
        {
          file: "src/notifications.ts",
          content: "",
          startLine: 1,
          endLine: 1,
          semanticScore: 0.9,
          metadata: { symbolName: "NotificationDeliveryModel" },
        },
        {
          file: "src/notifications.ts",
          content: "",
          startLine: 3,
          endLine: 5,
          semanticScore: 0.8,
          metadata: { symbolName: "sendEmailNotification" },
        },
      ],
      "email retry",
      2,
      false,
    )

    expect(phrases).toContain("notification delivery model")
    expect(phrases).toContain("send email notification")
  })
})

describe("hybrid retrieval ranking", () => {
  const result = (file: string, score: number, content: string, symbolName?: string) => ({
    file,
    content,
    startLine: 1,
    endLine: 5,
    semanticScore: score,
    metadata: { symbolName, isExported: true },
    whyMatched: ["semantic similarity"],
  })

  it("fuses semantic and lexical ranks without duplicating chunks", () => {
    const shared = result("src/auth.ts", 0.7, "validate authentication token", "validateToken")
    const fused = fuseHybridResults(
      [shared, result("src/session.ts", 0.8, "session storage")],
      [{ ...shared, semanticScore: 0.95, whyMatched: ["lexical retrieval: token"] }],
    )

    expect(fused).toHaveLength(2)
    expect(fused[0].file).toBe("src/auth.ts")
    expect(fused[0].whyMatched).toEqual(expect.arrayContaining(["semantic similarity", "lexical retrieval: token"]))
  })

  it("reranks with lexical and structural signals", () => {
    const reranked = rerankWorkingResults("validate token", [
      result("src/general.ts", 0.7, "generic helper"),
      result("src/token.ts", 0.7, "validate token and reject invalid token", "validateToken"),
    ])
    expect(reranked[0].file).toBe("src/token.ts")
    expect(reranked[0].rerankScore).toBeGreaterThan(reranked[1].rerankScore ?? 0)
  })

  it("prefers executable results in the requested domain over constants and foreign-domain handlers", () => {
    const reranked = rerankWorkingResults("google calendar webhook validation", [
      {
        ...result("src/asaas/webhook.ts", 0.84, "validate webhook signature", "validateAsaasWebhook"),
        metadata: { symbolName: "validateAsaasWebhook", symbolType: "function", isExported: true },
      },
      {
        ...result("src/google-calendar/constants.ts", 0.86, "google calendar webhook event names", "GOOGLE_CALENDAR_EVENTS"),
        metadata: { symbolName: "GOOGLE_CALENDAR_EVENTS", symbolType: "constant", isExported: true },
      },
      {
        ...result("src/google-calendar/webhook.ts", 0.81, "validate google calendar webhook notification", "validateGoogleCalendarWebhook"),
        metadata: { symbolName: "validateGoogleCalendarWebhook", symbolType: "function", isExported: true },
      },
    ])

    expect(reranked[0].metadata.symbolName).toBe("validateGoogleCalendarWebhook")
    expect(reranked.at(-1)?.metadata.symbolName).toBe("validateAsaasWebhook")
  })

  it("selects the best results inside an output token budget", () => {
    const selected = selectWithinTokenBudget([
      result("a.ts", 0.9, "x".repeat(400)),
      result("b.ts", 0.8, "y".repeat(400)),
    ], 150)
    expect(selected.results).toHaveLength(1)
    expect(selected.estimatedTokens).toBeLessThanOrEqual(150)
  })
})

describe("progressive result evidence", () => {
  it("reconstructs adjacent chunks and emits a decodable deterministic ID", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "sensegrep-symbol-"))
    await fs.writeFile(path.join(root, "a.ts"), [
      "export function calculate() {",
      "  const value = 1",
      "  return value",
      "}",
    ].join("\n"))
    try {
      const reconstructed = await reconstructSymbolResults(root, [
        { file: "a.ts", content: "synthetic imports", startLine: 1, endLine: 2, semanticScore: 0.8, metadata: { symbolName: "calculate" } },
        { file: "a.ts", content: "return value", startLine: 3, endLine: 4, semanticScore: 0.9, metadata: { symbolName: "calculate" } },
      ])
      expect(reconstructed).toHaveLength(1)
      expect(reconstructed[0].content).not.toContain("synthetic imports")
      expect(reconstructed[0].metadata).toMatchObject({ chunksMatched: 2, snippetIntegrity: "complete" })
      const structured = toStructuredSearchResult(reconstructed[0])
      expect(decodeResultId(structured.resultId)).toEqual({ file: "a.ts", startLine: 1, endLine: 4, symbol: "calculate" })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
