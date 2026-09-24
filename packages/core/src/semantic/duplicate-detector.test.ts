import { beforeEach, describe, expect, it, vi } from "vitest"

const baseRows = [
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

let rows = [...baseRows]
let searchDelayMs = 0

vi.mock("./lancedb.js", () => ({
  VectorStore: {
    resolveIndexedProject: vi.fn(async (root: string) => ({
      root,
      meta: {
        version: 1,
        root,
        embeddings: { provider: "gemini", model: "gemini-embedding-001", dimension: 2 },
        files: {},
        updatedAt: 1,
      },
    })),
    getCollectionUnsafe: vi.fn(async () => ({})),
    listDocuments: vi.fn(async () => rows),
    searchByVector: vi.fn(async (_collection: unknown, _vector: number[], options: { filters?: any; signal?: AbortSignal }) => {
      if (searchDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, searchDelayMs))
      options.signal?.throwIfAborted()
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
  it("uses memory for 513 candidates and resumes to the same groups as a full run", async () => {
    const { DuplicateDetector } = await import("./duplicate-detector.js")
    const { VectorStore } = await import("./lancedb.js")
    rows = Array.from({ length: 513 }, (_, i) => ({ ...baseRows[0], id: `memory-${i}`, metadata: { ...baseRows[0].metadata, file: `src/memory-${i}.ts` } }))
    vi.mocked(VectorStore.searchByVector).mockClear()
    const controller = new AbortController()
    const options = { path: process.cwd(), minLines: 1, ignoreAcceptablePatterns: true }
    const partial = await DuplicateDetector.detect({ ...options, signal: controller.signal,
      onProgress: ({ current }) => { if (current === 17) controller.abort() } })
    expect(partial.summary.resumeCursor).toBe(17)
    expect(partial.metrics?.strategy).toBe("memory-cosine")
    const resumed = await DuplicateDetector.detect({ ...options, resumeCursor: partial.summary.resumeCursor })
    const full = await DuplicateDetector.detect(options)
    expect(resumed.duplicates).toEqual(full.duplicates)
    expect(VectorStore.searchByVector).not.toHaveBeenCalled()
  })
  beforeEach(() => {
    rows = [...baseRows]
    searchDelayMs = 0
  })

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
    expect(result).toMatchObject({ schemaVersion: 1, command: "detect-duplicates", status: "complete" })
    expect(result.summary.analyzedCandidates).toBe(1)
    expect(result.duplicates).toEqual([])
  })

  it("does not report multiple chunks from the same source range as duplicates", async () => {
    rows = [
      baseRows[0],
      {
        ...baseRows[0],
        id: "a-overlap",
      },
    ]
    const { DuplicateDetector } = await import("./duplicate-detector.js")

    const result = await DuplicateDetector.detect({
      path: process.cwd(),
      minLines: 1,
      thresholds: { low: 0.5 },
    })

    expect(result.summary.candidates).toBe(2)
    expect(result.summary.analyzedCandidates).toBe(1)
    expect(result.summary.deduplicatedCandidates).toBe(1)
    expect(result.summary.truncated).toBe(false)
    expect(result.duplicates).toEqual([])
  })

  it("returns a resumable cursor when duplicate analysis is interrupted", async () => {
    const controller = new AbortController()
    const { DuplicateDetector } = await import("./duplicate-detector.js")

    const partial = await DuplicateDetector.detect({
      path: process.cwd(),
      minLines: 1,
      signal: controller.signal,
      onProgress: ({ current }) => {
        if (current === 1) controller.abort()
      },
    })

    expect(partial.summary).toMatchObject({
      aborted: true,
      processedCandidates: 1,
      analyzedCandidates: 1,
      resumeCursor: 1,
      truncated: true,
    })

    const resumed = await DuplicateDetector.detect({
      path: process.cwd(),
      minLines: 1,
      resumeCursor: partial.summary.resumeCursor,
    })
    expect(resumed.summary.processedCandidates).toBe(
      (resumed.summary.candidates ?? 0) - (partial.summary.resumeCursor ?? 0),
    )
    expect(resumed.summary.resumeCursor).toBeUndefined()
    expect(resumed.status).toBe("complete")
    const complete = await DuplicateDetector.detect({ path: process.cwd(), minLines: 1 })
    expect(resumed.duplicates).toEqual(complete.duplicates)
  })

  it("rejects continuation after the candidate set changes", async () => {
    const controller = new AbortController()
    const { DuplicateDetector } = await import("./duplicate-detector.js")
    const partial = await DuplicateDetector.detect({ path: process.cwd(), minLines: 1, signal: controller.signal,
      onProgress: ({ current }) => { if (current === 1) controller.abort() },
    })
    rows = [...baseRows, { ...baseRows[0], id: "new", metadata: { ...baseRows[0].metadata, file: "new.ts" } }]
    await expect(DuplicateDetector.detect({ path: process.cwd(), minLines: 1, resumeCursor: partial.summary.resumeCursor })).rejects.toThrow("does not match")
  })

  it("finds exact copies even when vector similarity and the neighbor cap would hide them", async () => {
    rows = [baseRows[0], { ...baseRows[0], id: "copy", vector: [0, 1], metadata: { ...baseRows[0].metadata, file: "copy.ts" } }]
    const { DuplicateDetector } = await import("./duplicate-detector.js")
    const result = await DuplicateDetector.detect({ path: process.cwd(), minLines: 1, ignoreAcceptablePatterns: true })
    expect(result.duplicates[0].similarity).toBe(1)
  })

  it("returns partial state when the wall-clock timeout expires during ANN lookup", async () => {
    searchDelayMs = 10
    rows = Array.from({ length: 513 }, (_, i) => ({ ...baseRows[0], id: `ann-${i}`, metadata: { ...baseRows[0].metadata, file: `src/ann-${i}.ts` } }))
    const { DuplicateDetector } = await import("./duplicate-detector.js")

    const result = await DuplicateDetector.detect({
      path: process.cwd(),
      minLines: 1,
      timeoutMs: 1,
    })

    expect(result.summary.timedOut).toBe(true)
    expect(result.summary.truncated).toBe(true)
    expect(result.summary.resumeCursor).toBe(0)
    expect(result.summary.processedCandidates).toBe(0)
  })
})
