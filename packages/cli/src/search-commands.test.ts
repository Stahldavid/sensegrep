import { describe, expect, it } from "vitest"
import {
  compactSearchResult,
  enforceActualOutputBudget,
  projectDuplicateResponse,
  projectGraphResponse,
  projectLiteralResponse,
  projectSearchResponse,
  withActualOutputMetrics,
} from "./search-commands.js"

describe("search command JSON contracts", () => {
  it("keeps only canonical decision fields in minimal mode", () => {
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
    })
    expect(compact).not.toHaveProperty("rawDistance")
    expect(compact).not.toHaveProperty("whyMatched")
    expect(compact).not.toHaveProperty("symbol")
    expect(compact).not.toHaveProperty("lines")
  })

  it("reports attempted and actual serialized output metrics separately", () => {
    const payload = withActualOutputMetrics({
      budget: { outputBytes: 95_830, emittedTokens: 23_958 },
      results: [{ resultId: "symbol:test", file: "a.ts" }],
    }) as any
    const serializedBytes = Buffer.byteLength(`${JSON.stringify(payload)}\n`)

    expect(payload.budget).toMatchObject({
      attemptedOutputBytes: 95_830,
      attemptedTokens: 23_958,
      actualOutputBytes: serializedBytes,
      outputBytes: serializedBytes,
      actualEmittedTokens: Math.ceil(serializedBytes / 4),
      emittedTokens: Math.ceil(serializedBytes / 4),
    })
  })

  it("projects minimal, content, and diagnostic search output without duplicate metadata", () => {
    const result = {
      schemaVersion: 1,
      command: "search",
      status: "complete",
      title: "query",
      metadata: { metrics: { totalMs: 10 } },
      warnings: [],
      retrieval: { actualMode: "hybrid", exhaustive: false },
      budget: { outputBytes: 100 },
      results: [{
        resultId: "symbol:test",
        file: "a.ts",
        startLine: 1,
        endLine: 2,
        symbolName: "run",
        symbolType: "function",
        score: 0.8,
        rankScore: 1,
        rawDistance: 0.2,
        distanceMetric: "cosine",
        content: "function run() {}",
        metadata: { file: "a.ts", symbolName: "run" },
      }],
    }
    const minimal = projectSearchResponse(result, "minimal")
    const content = projectSearchResponse(result, "content")
    const diagnostic = projectSearchResponse(result, "diagnostic")

    expect(minimal).not.toHaveProperty("metadata")
    expect(minimal).not.toHaveProperty("title")
    expect(minimal.results[0]).not.toHaveProperty("content")
    expect(content.results[0]).toMatchObject({ content: "function run() {}", rankScore: 1 })
    expect(content.results[0]).not.toHaveProperty("metadata")
    expect(diagnostic.results[0]).toMatchObject({ rawDistance: 0.2 })
    expect(diagnostic.results[0]).not.toHaveProperty("metadata")
    expect(diagnostic.results[0]).not.toHaveProperty("distanceMetric")
    expect(diagnostic.distanceMetric).toBe("cosine")
  })

  it("removes duplicate code unless explicitly requested", () => {
    const result = {
      schemaVersion: 1,
      command: "detect-duplicates",
      status: "complete",
      summary: { totalDuplicates: 1 },
      duplicates: [{
        level: "high",
        similarity: 0.9,
        impact: { estimatedSavings: 10, score: 5 },
        instances: [{ file: "a.ts", startLine: 1, endLine: 3, symbol: "run", content: "secret code" }],
      }],
    }
    expect(projectDuplicateResponse(result, "minimal", false).duplicates[0].instances[0]).not.toHaveProperty("content")
    expect(projectDuplicateResponse(result, "minimal", true).duplicates[0].instances[0]).toHaveProperty("content", "secret code")
  })

  it("projects literal and references without internal duplication", () => {
    const literal = projectLiteralResponse({
      status: "complete",
      metadata: { totalMatches: 1, returnedMatches: 1 },
      retrieval: { exhaustive: true, exhaustiveWithin: "indexed-files" },
      matches: [{ file: "a.ts", line: 2, text: "hit", chunkStartLine: 1 }],
    }, "minimal")
    const references = projectGraphResponse({
      command: "references",
      status: "complete",
      symbol: "run",
      definitions: [{ id: "target", file: "a.ts", startLine: 1, endLine: 2 }],
      references: [{ fromId: "source", toId: "target", to: "run", targetLocation: { id: "target" }, kind: "call", confidence: "high" }],
      metrics: { graphCoverage: 0.5 },
    }, "minimal")
    expect(literal.matches[0]).toEqual({ file: "a.ts", line: 2, text: "hit" })
    expect(references.references[0]).toEqual({ fromId: "source", kind: "call", confidence: "high" })
  })

  it("trims content results until the actual JSON fits maxOutputBytes", () => {
    const payload = enforceActualOutputBudget({
      schemaVersion: 1,
      command: "context",
      status: "complete",
      budget: { maxOutputBytes: 500, attemptedOutputBytes: 2_000, attemptedTokens: 500 },
      results: [
        { resultId: "one", content: "x".repeat(600) },
        { resultId: "two", content: "y".repeat(600) },
      ],
    }) as any
    expect(payload.status).toBe("incomplete")
    expect(payload.budget.actualOutputBytes).toBeLessThanOrEqual(500)
    expect(payload.results.length).toBeLessThan(2)
  })
})
