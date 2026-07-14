import { describe, expect, it } from "vitest"
import {
  compactSearchResult,
  enforceActualOutputBudget,
  projectDuplicateResponse,
  projectGraphResponse,
  projectLiteralResponse,
  projectSearchResponse,
  projectShowResponse,
  withActualOutputMetrics,
} from "./search-commands.js"

const rawSearchResult = {
  schemaVersion: 1,
  command: "search",
  status: "complete",
  title: "query",
  metadata: { metrics: { totalMs: 10 } },
  warnings: [],
  index: { fresh: true, schemaCompatible: true, snapshotId: "chunks:1" },
  retrieval: { actualMode: "hybrid", exhaustive: false, universe: { files: 2, chunks: 4 } },
  budget: { tokensUsed: 100 },
  results: [{
    resultId: "r:test",
    file: "src/a.ts",
    startLine: 10,
    endLine: 20,
    symbolName: "validateWebhook",
    symbolType: "function",
    semanticKind: "routeHandler",
    score: 0.9,
    rankScore: 1,
    rawDistance: 0.1,
    distanceMetric: "cosine",
    confidence: "high",
    whyMatched: ["semantic similarity"],
    content: "function validateWebhook() {}",
    snippetIntegrity: "complete",
    metadata: { file: "src/a.ts", fileRole: "implementation" },
  }],
}

describe("search command agent JSON contracts", () => {
  it("uses one canonical minimal card vocabulary", () => {
    const card = compactSearchResult(rawSearchResult.results[0])

    expect(card).toEqual({
      id: "r:test",
      file: "src/a.ts",
      lines: [10, 20],
      symbol: "validateWebhook",
      kind: "routeHandler",
      rank: 1,
      relevance: 0.9,
    })
    expect(card).not.toHaveProperty("resultId")
    expect(card).not.toHaveProperty("rankScore")
    expect(card).not.toHaveProperty("score")
  })

  it("projects minimal, content, and diagnostic as orthogonal payloads", () => {
    const minimal = projectSearchResponse(rawSearchResult, "minimal")
    const content = projectSearchResponse(rawSearchResult, "content")
    const diagnostic = projectSearchResponse(rawSearchResult, "diagnostic")

    expect(minimal).toMatchObject({
      schemaVersion: 2,
      command: "search",
      status: "complete",
      warnings: [],
      retrieval: { mode: "hybrid", exhaustive: false },
      index: { status: "fresh" },
    })
    expect(minimal).not.toHaveProperty("metadata")
    expect(minimal).not.toHaveProperty("budget")
    expect(minimal.results[0]).not.toHaveProperty("content")
    expect(content.results[0]).toMatchObject({ content: "function validateWebhook() {}", integrity: "complete" })
    expect(diagnostic.results[0]).not.toHaveProperty("content")
    expect(diagnostic.results[0].diagnostic).toMatchObject({ rawDistance: 0.1, distanceMetric: "cosine" })
    expect(diagnostic.diagnostic.metrics).toEqual(undefined)
  })

  it("reports only actual serialized metrics without legacy aliases", () => {
    const payload = withActualOutputMetrics({ budget: { maxBytes: 2_000 }, results: [{ id: "r:test", file: "a.ts" }] }) as any
    const serializedBytes = Buffer.byteLength(`${JSON.stringify(payload)}\n`)

    expect(payload.budget.usedBytes).toBe(serializedBytes)
    expect(payload.budget.usedTokens).toBe(Math.ceil(serializedBytes / 4))
    expect(payload.budget).not.toHaveProperty("actualOutputBytes")
    expect(payload.budget).not.toHaveProperty("outputBytes")
    expect(payload.budget).not.toHaveProperty("emittedTokens")
  })

  it("keeps filter explanations only when requested", () => {
    const source: any = structuredClone(rawSearchResult)
    source.results[0].filterMatches = { symbol: { matched: true } }
    const projected = projectSearchResponse(source, "minimal", false, true)
    expect(projected.results[0]).toMatchObject({
      why: ["semantic similarity"],
      filterMatches: { symbol: { matched: true } },
    })
  })

  it("removes duplicate code unless explicitly requested", () => {
    const result = {
      command: "detect-duplicates",
      status: "complete",
      summary: { totalDuplicates: 1, returnedDuplicates: 1 },
      duplicates: [{
        level: "high",
        similarity: 0.9,
        impact: { estimatedSavings: 10, score: 5 },
        instances: [{ file: "a.ts", startLine: 1, endLine: 3, symbol: "run", content: "secret code" }],
      }],
    }
    const minimal = projectDuplicateResponse(result, "minimal", false)
    expect(minimal.schemaVersion).toBe(2)
    expect(minimal.duplicates[0].instances[0]).toMatchObject({ file: "a.ts", lines: [1, 3], symbol: "run" })
    expect(minimal.duplicates[0].instances[0]).not.toHaveProperty("content")
    expect(projectDuplicateResponse(result, "minimal", true).duplicates[0].instances[0]).toHaveProperty("content", "secret code")
  })

  it("projects literal, graph, and show with canonical locations", () => {
    const literal = projectLiteralResponse({
      command: "literal",
      status: "complete",
      metadata: { totalMatches: 1, returnedMatches: 1, exhaustive: true },
      retrieval: { actualMode: "literal", exhaustive: true },
      matches: [{ file: "a.ts", line: 2, text: "hit", chunkStartLine: 1, chunkEndLine: 3, symbolName: "run" }],
    }, "minimal")
    const references = projectGraphResponse({
      command: "references",
      status: "complete",
      symbol: "run",
      definitions: [{ file: "a.ts", startLine: 1, endLine: 2, symbol: "run" }],
      references: [{ fromId: "source", kind: "call", confidence: "high" }],
      metrics: { graphCoverage: 0.5 },
    }, "minimal")
    const show = projectShowResponse({
      command: "show",
      status: "complete",
      index: { freshnessScope: "target-location", targetFresh: true },
      result: { resultId: "r:test", file: "a.ts", symbol: "run", startLine: 1, endLine: 2, content: "code", snippetIntegrity: "complete" },
    }, "content")

    expect(literal.summary).toEqual({ total: 1, returned: 1, truncated: false, exhaustive: true })
    expect(literal.matches[0]).toMatchObject({ id: expect.stringMatching(/^r:/), file: "a.ts", line: 2, symbol: "run" })
    expect(references.definitions[0]).toMatchObject({ file: "a.ts", lines: [1, 2], symbol: "run" })
    expect(show).toMatchObject({ index: { status: "fresh", scope: "target-location" }, result: { id: "r:test", lines: [1, 2] } })
  })

  it("truncates the first content card instead of returning no evidence", () => {
    const payload = enforceActualOutputBudget({
      schemaVersion: 2,
      command: "context",
      status: "complete",
      retrieval: { mode: "hybrid", exhaustive: false },
      budget: { maxBytes: 500 },
      results: [{ id: "one", file: "a.ts", lines: [1, 100], content: "x".repeat(1_000) }],
    }) as any

    expect(payload.status).toBe("incomplete")
    expect(payload.results).toHaveLength(1)
    expect(payload.results[0].content.length).toBeGreaterThan(0)
    expect(payload.results[0].contentTruncated).toBe(true)
    expect(payload.results[0].lines).toEqual([1, 100])
    expect(payload.results[0].contentLines[0]).toBe(1)
    expect(payload.results[0].contentLines[1]).toBeLessThan(100)
    expect(payload.budget.usedBytes).toBeLessThanOrEqual(500)
  })

  it.each([100, 400, 1_000, 2_000])("never exceeds a %i-byte physical output budget", (maxBytes) => {
    const payload = enforceActualOutputBudget({
      schemaVersion: 2,
      command: "literal",
      status: "complete",
      retrieval: { mode: "literal", exhaustive: true },
      budget: { maxBytes },
      summary: { total: 20, returned: 20, truncated: false, exhaustive: true },
      matches: Array.from({ length: 20 }, (_, index) => ({ file: `src/${index}.ts`, line: index + 1, text: "x".repeat(100) })),
    }) as any
    expect(Buffer.byteLength(`${JSON.stringify(payload)}\n`)).toBeLessThanOrEqual(maxBytes)
    expect(payload.schemaVersion).toBe(2)
  })
})
