import { afterEach, describe, expect, it, vi } from "vitest"
import { estimateOllamaRequests, getOllamaBatchSize } from "./ollama-batching.js"

afterEach(() => vi.unstubAllEnvs())

describe("Ollama HTTP batch estimates", () => {
  it("counts HTTP requests instead of index batches for a full index", () => {
    vi.stubEnv("SENSEGREP_OLLAMA_BATCH_SIZE", "")
    vi.stubEnv("SENSEGREP_EMBED_BATCH_SIZE", "")
    expect(getOllamaBatchSize()).toBe(16)
    expect(estimateOllamaRequests(6879, 256)).toBe(430)
    expect(estimateOllamaRequests(0, 256)).toBe(0)
  })

  it("respects independent index boundaries and local overrides", () => {
    vi.stubEnv("SENSEGREP_OLLAMA_BATCH_SIZE", "32")
    vi.stubEnv("SENSEGREP_EMBED_BATCH_SIZE", "16")
    expect(getOllamaBatchSize()).toBe(32)
    expect(estimateOllamaRequests(33, 16)).toBe(3)
    expect(estimateOllamaRequests(513, 256)).toBe(17)
  })

  it("uses the generic batch override when the Ollama override is unset", () => {
    vi.stubEnv("SENSEGREP_OLLAMA_BATCH_SIZE", "")
    vi.stubEnv("SENSEGREP_EMBED_BATCH_SIZE", "20")
    expect(getOllamaBatchSize()).toBe(20)
    expect(estimateOllamaRequests(41, 20)).toBe(3)
  })

  it("rejects invalid HTTP batch sizes", () => {
    vi.stubEnv("SENSEGREP_OLLAMA_BATCH_SIZE", "0")
    expect(() => getOllamaBatchSize()).toThrow("must be a positive number")
  })
})
