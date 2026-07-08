import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const ENV_KEYS = [
  "SENSEGREP_PROVIDER",
  "SENSEGREP_EMBED_MODEL",
  "SENSEGREP_EMBED_DIM",
  "SENSEGREP_BEDROCK_REGION",
  "SENSEGREP_OPENAI_API_KEY",
  "SENSEGREP_OPENAI_BASE_URL",
  "SENSEGREP_OPENAI_BATCH_SIZE",
  "SENSEGREP_OPENROUTER_REFERER",
  "SENSEGREP_OPENROUTER_TITLE",
  "SENSEGREP_OLLAMA_BASE_URL",
  "FIREWORKS_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "SENSEGREP_RATE_LIMIT_RPM",
  "SENSEGREP_RATE_LIMIT_TPM",
  "SENSEGREP_MAX_RETRIES",
  "SENSEGREP_RETRY_BASE_DELAY_MS",
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
  beforeEach(() => {
    clearEnv()
  })

  afterEach(() => {
    clearEnv()
    vi.resetModules()
    vi.doUnmock("node:fs")
  })

  it("defaults to native Ollama when no API credentials or provider are configured", async () => {
    mockMissingGlobalConfig()

    const { getEmbeddingConfig } = await import("./embedding-config.js")
    const config = getEmbeddingConfig()

    expect(config).toMatchObject({
      provider: "ollama",
      embedModel: "qwen3-embedding:0.6b",
      embedDim: 1024,
      baseUrl: "http://127.0.0.1:11434",
    })
    expect(config.apiKey).toBeUndefined()
  })

  it("keeps configured cloud providers ahead of Ollama fallback", async () => {
    mockMissingGlobalConfig()
    process.env.GEMINI_API_KEY = "gemini-key"

    const { getEmbeddingConfig } = await import("./embedding-config.js")
    const config = getEmbeddingConfig()

    expect(config.provider).toBe("gemini")
    expect(config.apiKey).toBe("gemini-key")
  })

  it("allows explicit Ollama model, dimension, and base URL", async () => {
    mockMissingGlobalConfig()
    process.env.SENSEGREP_PROVIDER = "ollama"
    process.env.SENSEGREP_EMBED_MODEL = "qwen3-embedding:0.6b"
    process.env.SENSEGREP_EMBED_DIM = "1024"
    process.env.SENSEGREP_OLLAMA_BASE_URL = "http://localhost:11434"

    const { getEmbeddingConfig } = await import("./embedding-config.js")
    const config = getEmbeddingConfig()

    expect(config).toMatchObject({
      provider: "ollama",
      embedModel: "qwen3-embedding:0.6b",
      embedDim: 1024,
      baseUrl: "http://localhost:11434",
    })
  })

  it("rejects unsupported embedding providers", async () => {
    mockMissingGlobalConfig()
    process.env.SENSEGREP_PROVIDER = "fastembed"

    const { getEmbeddingConfig } = await import("./embedding-config.js")

    expect(() => getEmbeddingConfig()).toThrow(/Use "gemini", "openai", "bedrock", or "ollama"/)
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

  it("reads OpenAI-compatible batch size and OpenRouter metadata", async () => {
    mockMissingGlobalConfig()
    process.env.SENSEGREP_PROVIDER = "openai"
    process.env.SENSEGREP_OPENAI_API_KEY = "openrouter-key"
    process.env.SENSEGREP_OPENAI_BASE_URL = "https://openrouter.ai/api/v1"
    process.env.SENSEGREP_EMBED_MODEL = "qwen/qwen3-embedding-8b"
    process.env.SENSEGREP_EMBED_DIM = "1024"
    process.env.SENSEGREP_OPENAI_BATCH_SIZE = "96"
    process.env.SENSEGREP_OPENROUTER_REFERER = "https://example.com"
    process.env.SENSEGREP_OPENROUTER_TITLE = "example-app"

    const { getEmbeddingConfig } = await import("./embedding-config.js")
    const config = getEmbeddingConfig()

    expect(config).toMatchObject({
      provider: "openai",
      embedModel: "qwen/qwen3-embedding-8b",
      embedDim: 1024,
      baseUrl: "https://openrouter.ai/api/v1",
      batchSize: 96,
      openRouterReferer: "https://example.com",
      openRouterTitle: "example-app",
    })
  })

  it("rejects invalid numeric rate limit environment variables", async () => {
    mockMissingGlobalConfig()
    process.env.SENSEGREP_RATE_LIMIT_RPM = "abc"

    const { getEmbeddingConfig } = await import("./embedding-config.js")

    expect(() => getEmbeddingConfig()).toThrow(/SENSEGREP_RATE_LIMIT_RPM must be a positive number/)
  })

  it("parses valid numeric rate limit environment variables", async () => {
    mockMissingGlobalConfig()
    process.env.SENSEGREP_RATE_LIMIT_RPM = "120"
    process.env.SENSEGREP_RATE_LIMIT_TPM = "4000"
    process.env.SENSEGREP_MAX_RETRIES = "3"
    process.env.SENSEGREP_RETRY_BASE_DELAY_MS = "250"

    const { getEmbeddingConfig } = await import("./embedding-config.js")
    const config = getEmbeddingConfig()

    expect(config.rateLimit).toEqual({
      rpm: 120,
      tpm: 4000,
      maxRetries: 3,
      retryBaseDelayMs: 250,
    })
  })
})
