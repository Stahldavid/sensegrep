import { afterEach, describe, expect, it, vi } from "vitest"

const ENV_KEYS = [
  "SENSEGREP_PROVIDER",
  "SENSEGREP_EMBED_MODEL",
  "SENSEGREP_EMBED_DIM",
  "SENSEGREP_BEDROCK_REGION",
  "SENSEGREP_OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
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

describe("embedding config", () => {
  afterEach(() => {
    clearEnv()
    vi.resetModules()
    vi.doUnmock("node:fs")
  })

  it("resolves Bedrock defaults from environment", async () => {
    mockMissingGlobalConfig()
    process.env.SENSEGREP_PROVIDER = "bedrock"
    process.env.SENSEGREP_BEDROCK_REGION = "us-east-1"

    const { getEmbeddingConfig } = await import("./embedding-config.js")
    const config = getEmbeddingConfig()

    expect(config.provider).toBe("bedrock")
    expect(config.embedModel).toBe("cohere.embed-v4:0")
    expect(config.embedDim).toBe(1536)
    expect(config.region).toBe("us-east-1")
  })

  it("allows Bedrock overrides for model, dimension, and AWS region", async () => {
    mockMissingGlobalConfig()
    process.env.SENSEGREP_PROVIDER = "bedrock"
    process.env.SENSEGREP_EMBED_MODEL = "global.cohere.embed-v4:0"
    process.env.SENSEGREP_EMBED_DIM = "1024"
    process.env.SENSEGREP_BEDROCK_REGION = "eu-west-1"

    const { getEmbeddingConfig } = await import("./embedding-config.js")
    const config = getEmbeddingConfig()

    expect(config.provider).toBe("bedrock")
    expect(config.embedModel).toBe("global.cohere.embed-v4:0")
    expect(config.embedDim).toBe(1024)
    expect(config.region).toBe("eu-west-1")
  })

  it("does not use Gemini env keys for OpenAI-compatible provider", async () => {
    mockMissingGlobalConfig()
    process.env.SENSEGREP_PROVIDER = "openai"
    process.env.GEMINI_API_KEY = "gemini-should-not-win"
    process.env.SENSEGREP_OPENAI_API_KEY = "openai-key"

    const { getEmbeddingConfig } = await import("./embedding-config.js")
    const config = getEmbeddingConfig()

    expect(config.provider).toBe("openai")
    expect(config.apiKey).toBe("openai-key")
  })
})
