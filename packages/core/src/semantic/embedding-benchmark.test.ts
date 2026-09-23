import { beforeEach, describe, expect, it, vi } from "vitest"

const getConfig = vi.fn()
const getRequestBatchSize = vi.fn()
const embed = vi.fn()
const withConfig = vi.fn(async (_config, fn) => fn())

vi.mock("./embeddings.js", () => ({
  Embeddings: {
    getConfig,
    getRequestBatchSize,
    embed,
    withConfig,
  },
}))

describe("EmbeddingBenchmark", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getConfig.mockReturnValue({ provider: "openai", embedModel: "test-model", embedDim: 3 })
    getRequestBatchSize.mockReturnValue(2)
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

  it.each(["ollama", "gemini", "bedrock"])("reports only a baseline for sequential %s adapters", async (provider) => {
    getConfig.mockReturnValue({ provider, embedModel: "test-model", embedDim: 3 })
    const { EmbeddingBenchmark } = await import("./embedding-benchmark.js")
    const result = await EmbeddingBenchmark.run({ concurrencyCandidates: [2, 4], sampleCount: 32 })
    expect(result.concurrencySupported).toBe(false)
    expect(result.trials.map((trial) => trial.concurrency)).toEqual([1])
    expect(result.recommendedConcurrency).toBeNull()
    expect(result.recommendedEnvironment).toEqual({})
    expect(result.warnings[0]).toContain("sequentially")
    expect(withConfig).toHaveBeenCalledWith({ concurrency: 1 }, expect.any(Function))
  })

  it("does not recommend concurrency when an OpenAI sample fits in one request", async () => {
    getRequestBatchSize.mockReturnValue(64)
    const { EmbeddingBenchmark } = await import("./embedding-benchmark.js")
    const result = await EmbeddingBenchmark.run({ concurrencyCandidates: [1, 4], sampleCount: 16 })
    expect(result.concurrencySupported).toBe(true)
    expect(result.recommendedConcurrency).toBeNull()
    expect(result.recommendedEnvironment).toEqual({})
    expect(result.trials).toHaveLength(1)
    expect(result.warnings[0]).toContain("one HTTP batch")
  })

  it("rejects inconsistent provider output", async () => {
    embed.mockResolvedValueOnce([[1, 0, 0]]).mockResolvedValueOnce([[1, 0, 0]])
    const { EmbeddingBenchmark } = await import("./embedding-benchmark.js")

    await expect(EmbeddingBenchmark.run({ concurrencyCandidates: [1], sampleCount: 4 })).rejects.toThrow(/returned 1 vectors/)
  })
})
