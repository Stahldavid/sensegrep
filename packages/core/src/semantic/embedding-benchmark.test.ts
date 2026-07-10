import { beforeEach, describe, expect, it, vi } from "vitest"

const embed = vi.fn()
const withConfig = vi.fn(async (_config, fn) => fn())

vi.mock("./embeddings.js", () => ({
  Embeddings: {
    getConfig: () => ({ provider: "openai", embedModel: "test-model", embedDim: 3 }),
    embed,
    withConfig,
  },
}))

describe("EmbeddingBenchmark", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    embed.mockImplementation(async (texts: string[]) => texts.map(() => [1, 0, 0]))
  })

  it("validates vectors and recommends one of the measured concurrency levels", async () => {
    const { EmbeddingBenchmark } = await import("./embedding-benchmark.js")

    const result = await EmbeddingBenchmark.run({ concurrencyCandidates: [1, 2], sampleCount: 4 })

    expect(result.trials).toHaveLength(2)
    expect([1, 2]).toContain(result.recommendedConcurrency)
    expect(result.recommendedEnvironment.SENSEGREP_OPENAI_CONCURRENCY).toBeDefined()
    expect(withConfig).toHaveBeenCalledTimes(2)
  })

  it("rejects inconsistent provider output", async () => {
    embed.mockResolvedValueOnce([[1, 0, 0]]).mockResolvedValueOnce([[1, 0, 0]])
    const { EmbeddingBenchmark } = await import("./embedding-benchmark.js")

    await expect(EmbeddingBenchmark.run({ concurrencyCandidates: [1], sampleCount: 4 })).rejects.toThrow(/returned 1 vectors/)
  })
})
