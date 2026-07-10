import { describe, expect, it } from "vitest"
import { compactSearchResult, withActualOutputMetrics } from "./search-commands.js"

describe("search command JSON contracts", () => {
  it("keeps canonical result field names and distance metadata in compact mode", () => {
    const compact = compactSearchResult({
      resultId: "symbol:test",
      file: "src/a.ts",
      startLine: 10,
      endLine: 20,
      symbolName: "validateWebhook",
      symbolType: "function",
      score: 0.9,
      rawDistance: 0.1,
      distanceMetric: "cosine",
      whyMatched: ["semantic similarity"],
    })

    expect(compact).toMatchObject({
      symbolName: "validateWebhook",
      startLine: 10,
      endLine: 20,
      rawDistance: 0.1,
      distanceMetric: "cosine",
    })
    expect(compact).not.toHaveProperty("symbol")
    expect(compact).not.toHaveProperty("lines")
  })

  it("reports attempted and actual serialized output metrics separately", () => {
    const payload = withActualOutputMetrics({
      budget: { outputBytes: 95_830, emittedTokens: 23_958 },
      results: [{ resultId: "symbol:test", file: "a.ts" }],
    }) as any
    const serializedBytes = Buffer.byteLength(`${JSON.stringify(payload, null, 2)}\n`)

    expect(payload.budget).toMatchObject({
      attemptedOutputBytes: 95_830,
      attemptedTokens: 23_958,
      actualOutputBytes: serializedBytes,
      outputBytes: serializedBytes,
      actualEmittedTokens: Math.ceil(serializedBytes / 4),
      emittedTokens: Math.ceil(serializedBytes / 4),
    })
  })
})
