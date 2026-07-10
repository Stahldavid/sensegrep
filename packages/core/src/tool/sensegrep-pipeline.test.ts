import { describe, expect, it } from "vitest"
import {
  annotateWorkingResults,
  fuseHybridResults,
  getDominantSymbolPhrases,
  rerankWorkingResults,
  selectWithinTokenBudget,
} from "./sensegrep-pipeline.js"

describe("sensegrep pipeline result metadata", () => {
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

  it("selects the best results inside an output token budget", () => {
    const selected = selectWithinTokenBudget([
      result("a.ts", 0.9, "x".repeat(400)),
      result("b.ts", 0.8, "y".repeat(400)),
    ], 150)
    expect(selected.results).toHaveLength(1)
    expect(selected.estimatedTokens).toBeLessThanOrEqual(150)
  })
})
