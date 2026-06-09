import { describe, expect, it } from "vitest"
import { annotateWorkingResults, getDominantSymbolPhrases } from "./sensegrep-pipeline.js"

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
