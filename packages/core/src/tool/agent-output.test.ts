import { describe, expect, it } from "vitest"
import { projectAgentResponse, enforceAgentOutputBudget } from "./agent-output.js"

describe("shared agent output projection", () => {
  it("keeps ranking strength separate from answer sufficiency", () => {
    const response = projectAgentResponse({ command: "search", results: [{ file: "test.ts", score: 0.9, confidence: "high" }] }, { detail: "diagnostic" })
    expect(response.answerSufficiency).toBe("not-assessed")
    expect(response.results[0].diagnostic.rankingStrength).toBe("high")
    expect(response.results[0].diagnostic).not.toHaveProperty("confidence")
  })

  it.each([false, true])("enforces serialized bytes, including UTF-8 and pretty=%s", (pretty) => {
    const response = enforceAgentOutputBudget({ command: "search", status: "complete", budget: { maxBytes: 512 },
      results: [{ file: "ação.ts", lines: [1, 100], content: "ação 🐈\n".repeat(100) }] }, { pretty, trailingNewline: true })
    const serialized = JSON.stringify(response, null, pretty ? 2 : undefined) + "\n"
    expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(512)
    expect(response.status).toBe("incomplete")
    expect(response.budget.usedBytes).toBe(Buffer.byteLength(serialized))
    expect(JSON.parse(serialized)).toEqual(response)
  })
  it("makes grouped summaries compact and directly expandable", () => {
    const projected = projectAgentResponse({
      command: "survey",
      status: "complete",
      title: "webhooks",
      metadata: { freshness: { isStale: false }, budget: { tokensUsed: 500 } },
      freshness: { isStale: false },
      index: { fresh: true, schemaCompatible: true, snapshotId: "chunks:1" },
      retrieval: { actualMode: "hybrid", exhaustive: false },
      budget: { tokensUsed: 500 },
      groups: [{
        title: "endpoints / routing",
        score: 12.5,
        matches: 8,
        files: ["src/http.ts"],
        imports: ["server", "api"],
        symbols: ["webhook", "validate"],
        representativeTerms: ["webhook", "validation", "idempotency"],
        whyGrouped: ["shared imports/signals: server"],
        representativeIds: ["r:first", "r:second"],
        returnedResults: 0,
        omittedResults: 8,
      }],
    }, { groupedDetail: "summary" })

    expect(projected).toEqual({
      schemaVersion: 2,
      command: "survey",
      status: "complete",
      warnings: [],
      retrieval: { mode: "hybrid", exhaustive: false, truncated: false },
      index: { status: "fresh" },
      groups: [{
        label: "endpoints / routing",
        rank: 1,
        matches: 8,
        files: ["src/http.ts"],
        terms: ["webhook", "validation", "idempotency"],
        representativeIds: ["r:first", "r:second"],
      }],
    })
  })

  it("normalizes warnings into stable machine-readable codes", () => {
    const projected = projectAgentResponse({
      command: "search",
      status: "complete",
      warnings: ["Embedding provider returned no vectors; lexical-fallback used."],
      results: [],
    })
    expect(projected.warnings).toEqual([{
      code: "EMBEDDING_FALLBACK",
      message: "Embedding provider returned no vectors; lexical-fallback used.",
    }])
  })

  it("keeps graph diagnostics in the canonical v2 envelope", () => {
    const projected = projectAgentResponse({
      schemaVersion: 1,
      command: "trace",
      status: "complete",
      from: "a",
      to: "b",
      found: true,
      path: ["a", "b"],
      pathNodes: [{ file: "src/a.ts", startLine: 1, endLine: 2, name: "a" }],
      metrics: { graphCoverage: 0.5, unresolvedEdges: 2 },
    }, { detail: "diagnostic" })

    expect(projected).toMatchObject({
      schemaVersion: 2,
      command: "trace",
      diagnostic: { metrics: { unresolvedEdges: 2 } },
    })
    expect(projected).not.toHaveProperty("pathNodes")
  })
})
