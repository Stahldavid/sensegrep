import { describe, expect, it, vi } from "vitest"

const rows = [
  {
    id: "a",
    content: "export function alpha(value: number) {\n  return value + 1\n}\n",
    contentRaw: "export function alpha(value: number) {\n  return value + 1\n}\n",
    metadata: {
      file: "src/a.ts",
      startLine: 1,
      endLine: 3,
      symbolName: "alpha",
      symbolType: "function",
      complexity: 1,
      isExported: true,
      language: "typescript",
    },
    vector: [1, 0],
  },
  {
    id: "b",
    content: "export function beta(input: number) {\n  return input + 1\n}\n",
    contentRaw: "export function beta(input: number) {\n  return input + 1\n}\n",
    metadata: {
      file: "src/b.ts",
      startLine: 1,
      endLine: 3,
      symbolName: "beta",
      symbolType: "function",
      complexity: 1,
      isExported: true,
      language: "typescript",
    },
    vector: [1, 0],
  },
  {
    id: "doc",
    content: "# docs\n",
    contentRaw: "# docs\n",
    metadata: {
      file: "docs/a.md",
      startLine: 1,
      endLine: 1,
      symbolName: "docs",
      symbolType: "module",
      complexity: 0,
      isExported: false,
      language: "markdown",
    },
    vector: [0, 1],
  },
]

vi.mock("./lancedb.js", () => ({
  VectorStore: {
    resolveIndexedProject: vi.fn(async (root: string) => ({
      root,
      meta: {
        version: 1,
        root,
        embeddings: { provider: "gemini", model: "gemini-embedding-001", dimension: 2 },
        files: {},
        updatedAt: Date.now(),
      },
    })),
    getCollectionUnsafe: vi.fn(async () => ({})),
    listDocuments: vi.fn(async () => rows),
    searchByVector: vi.fn(async (_collection: unknown, _vector: number[], options: { filters?: any }) => {
      const scopeValues = options.filters?.all?.find((filter: any) => filter.key === "symbolType")?.value ?? []
      return rows
        .filter((row) => scopeValues.length === 0 || scopeValues.includes(row.metadata.symbolType))
        .map((row) => ({ id: row.id, distance: row.id === "doc" ? 1 : 0.01 }))
    }),
    distanceToSimilarity: vi.fn((distance: number) => 1 - distance),
    getDistanceMetric: vi.fn(() => "cosine"),
  },
}))

describe("DuplicateDetector", () => {
  it("matches basename globs against nested files for include/exclude filters", async () => {
    const { DuplicateDetector } = await import("./duplicate-detector.js")

    const result = await DuplicateDetector.detect({
      path: process.cwd(),
      include: "*.ts",
      exclude: "b.ts",
      minLines: 1,
      thresholds: { low: 0.5 },
    })

    expect(result.summary.candidates).toBe(1)
    expect(result.summary.analyzedCandidates).toBe(1)
    expect(result.duplicates).toEqual([])
  })
})
