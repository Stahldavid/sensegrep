import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const ENV_KEYS = [
  "SENSEGREP_PROVIDER",
  "SENSEGREP_EMBED_MODEL",
  "SENSEGREP_EMBED_DIM",
  "SENSEGREP_EMBED_MAX_TOKENS",
] as const

function clearEnv() {
  for (const key of ENV_KEYS) {
    delete process.env[key]
  }
}

function mockMissingGlobalConfig() {
  vi.doMock("node:fs", async () => {
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs")
    const readFileSync = vi.fn(() => {
      throw new Error("ENOENT")
    })
    return {
      ...actual,
      default: {
        ...actual,
        readFileSync,
      },
      readFileSync,
    }
  })
}

describe("chunk limits", () => {
  beforeEach(() => {
    clearEnv()
    mockMissingGlobalConfig()
  })

  afterEach(() => {
    clearEnv()
    vi.resetModules()
    vi.doUnmock("node:fs")
  })

  it("preserves complete symbols without complexity-specific caps", async () => {
    process.env.SENSEGREP_PROVIDER = "openai"
    process.env.SENSEGREP_EMBED_MODEL = "qwen/qwen3-embedding-4b"
    process.env.SENSEGREP_EMBED_DIM = "1024"

    const { getTreeSitterChunkLimits } = await import("./chunk-limits.js")
    const limits = getTreeSitterChunkLimits()

    expect(limits.tokens.modelMax).toBe(32_768)
    expect(limits.tokens.max).toBe(7_000)
    expect(limits.max).toBe(28_000)
    expect(limits.config).toEqual({
      simple: 16_384,
      medium: 16_384,
      complex: 16_384,
    })
    expect(limits.overlap).toBe(512)
    expect(limits.statementOverlap).toBe(3)
  })

  it("scales chunk limits down for small embedding contexts or explicit overrides", async () => {
    process.env.SENSEGREP_PROVIDER = "openai"
    process.env.SENSEGREP_EMBED_MODEL = "custom/embedding-model"
    process.env.SENSEGREP_EMBED_DIM = "768"
    process.env.SENSEGREP_EMBED_MAX_TOKENS = "2048"

    const { getTreeSitterChunkLimits } = await import("./chunk-limits.js")
    const limits = getTreeSitterChunkLimits()

    expect(limits.tokens.modelMax).toBe(2_048)
    expect(limits.tokens.usableModel).toBe(2_007)
    expect(limits.tokens.max).toBe(2_007)
    expect(limits.max).toBe(8_028)
    expect(limits.config).toEqual({
      simple: 8_028,
      medium: 8_028,
      complex: 8_028,
    })
  })
})
