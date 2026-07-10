import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const sendMock = vi.fn()
const clientCtor = vi.fn()

function sizedVector(dim: number, first = 1, second = 0, third = 0): number[] {
  const vector = Array.from({ length: dim }, () => 0)
  vector[0] = first
  if (dim > 1) vector[1] = second
  if (dim > 2) vector[2] = third
  return vector
}

vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: class BedrockRuntimeClient {
    constructor(config: any) {
      clientCtor(config)
    }

    send(command: any) {
      return sendMock(command)
    }
  },
  InvokeModelCommand: class InvokeModelCommand {
    input: any

    constructor(input: any) {
      this.input = input
    }
  },
}))

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

describe("EmbeddingsRemote Bedrock", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockMissingGlobalConfig()
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.doUnmock("node:fs")
  })

  it("invokes Bedrock with search_query and normalizes float embeddings", async () => {
    sendMock.mockResolvedValue({
      body: new TextEncoder().encode(
        JSON.stringify({
          response_type: "embeddings_floats",
          embeddings: [sizedVector(1024, 3, 4)],
        }),
      ),
    })

    const { EmbeddingsRemote } = await import("./embeddings-remote.js")
    EmbeddingsRemote.configure({
      provider: "bedrock",
      embedModel: "cohere.embed-v4:0",
      embedDim: 1024,
      region: "us-east-1",
      apiKey: "bedrock-token",
    })

    const [vector] = await EmbeddingsRemote.embed("find auth flow", { taskType: "RETRIEVAL_QUERY" })
    const command = sendMock.mock.calls[0][0]
    const body = JSON.parse(command.input.body)

    expect(clientCtor).toHaveBeenCalledWith({
      authSchemePreference: ["httpBearerAuth"],
      region: "us-east-1",
      token: { token: "bedrock-token" },
    })
    expect(body.input_type).toBe("search_query")
    expect(body.output_dimension).toBe(1024)
    expect(body.embedding_types).toEqual(["float"])
    expect(vector[0]).toBeCloseTo(0.6)
    expect(vector[1]).toBeCloseTo(0.8)
  })

  it("parses float embeddings returned in the typed Bedrock response shape", async () => {
    sendMock.mockResolvedValue({
      body: new TextEncoder().encode(
        JSON.stringify({
          response_type: "embeddings_by_type",
          embeddings: {
            float: [sizedVector(1536, 1, 2, 2)],
          },
        }),
      ),
    })

    const { EmbeddingsRemote } = await import("./embeddings-remote.js")
    EmbeddingsRemote.configure({
      provider: "bedrock",
      embedModel: "cohere.embed-v4:0",
      embedDim: 1536,
    })

    const [vector] = await EmbeddingsRemote.embed(["doc one"], { taskType: "RETRIEVAL_DOCUMENT" })
    const command = sendMock.mock.calls[0][0]
    const body = JSON.parse(command.input.body)

    expect(body.input_type).toBe("search_document")
    expect(vector[0]).toBeCloseTo(1 / 3)
    expect(vector[1]).toBeCloseTo(2 / 3)
    expect(vector[2]).toBeCloseTo(2 / 3)
  })

  it("truncates Bedrock inputs longer than the API char limit", async () => {
    sendMock.mockResolvedValue({
      body: new TextEncoder().encode(
        JSON.stringify({
          response_type: "embeddings_floats",
          embeddings: [sizedVector(1536, 1, 0)],
        }),
      ),
    })

    const { EmbeddingsRemote } = await import("./embeddings-remote.js")
    EmbeddingsRemote.configure({
      provider: "bedrock",
      embedModel: "cohere.embed-v4:0",
      embedDim: 1536,
    })

    const longText = "x".repeat(10_000)
    await EmbeddingsRemote.embed(longText, { taskType: "RETRIEVAL_DOCUMENT" })

    const command = sendMock.mock.calls[0][0]
    const body = JSON.parse(command.input.body)
    expect(body.texts[0].length).toBeLessThanOrEqual(8192)
  })
})

describe("EmbeddingsRemote OpenAI-compatible", () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockMissingGlobalConfig()
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.doUnmock("node:fs")
    vi.unstubAllGlobals()
    delete process.env.SENSEGREP_OPENAI_API_KEY
    delete process.env.SENSEGREP_OPENAI_BATCH_SIZE
    delete process.env.SENSEGREP_OPENAI_CONCURRENCY
    delete process.env.SENSEGREP_EMBED_CONCURRENCY
    delete process.env.SENSEGREP_EMBED_MAX_TOKENS
    delete process.env.FIREWORKS_API_KEY
    delete process.env.OPENAI_API_KEY
  })

  it("uses apiKey from embedding config without environment variables", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ index: 0, embedding: sizedVector(1024, 3, 4) }],
      }),
    })

    const { EmbeddingsRemote } = await import("./embeddings-remote.js")
    EmbeddingsRemote.configure({
      provider: "openai",
      embedModel: "text-embedding-qwen3-embedding-0.6b",
      embedDim: 1024,
      baseUrl: "http://127.0.0.1:1234/v1",
      apiKey: "lm-studio",
    })

    const [vector] = await EmbeddingsRemote.embed("find auth flow", { skipValidation: true })
    const [, init] = fetchMock.mock.calls[0]

    expect(init.headers.Authorization).toBe("Bearer lm-studio")
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:1234/v1/embeddings")
    expect(vector[0]).toBeCloseTo(0.6)
    expect(vector[1]).toBeCloseTo(0.8)
  })

  it("uses OpenRouter Qwen defaults for batch size, dimensions, and metadata headers", async () => {
    fetchMock.mockImplementation(async (_url: string, init: any) => {
      const body = JSON.parse(init.body)
      return {
        ok: true,
      json: async () => ({
        data: body.input.map((_text: string, index: number) => ({ index, embedding: sizedVector(body.dimensions) })),
      }),
      }
    })

    const { EmbeddingsRemote } = await import("./embeddings-remote.js")
    EmbeddingsRemote.configure({
      provider: "openai",
      embedModel: "qwen/qwen3-embedding-8b",
      embedDim: 1024,
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "openrouter-key",
      openRouterReferer: "https://example.com",
      openRouterTitle: "example-app",
    })

    const texts = Array.from({ length: 100 }, (_, index) => `chunk ${index}`)
    const vectors = await EmbeddingsRemote.embed(texts, { skipValidation: true })
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body)
    const headers = fetchMock.mock.calls[0][1].headers

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(firstBody.input).toHaveLength(96)
    expect(secondBody.input).toHaveLength(4)
    expect(firstBody.dimensions).toBe(1024)
    expect(headers["HTTP-Referer"]).toBe("https://example.com")
    expect(headers["X-Title"]).toBe("example-app")
    expect(vectors).toHaveLength(100)
  })

  it("runs OpenAI-compatible batches concurrently while preserving vector order", async () => {
    let inFlight = 0
    let maxInFlight = 0
    fetchMock.mockImplementation(async (_url: string, init: any) => {
      const body = JSON.parse(init.body)
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      if (body.input[0] === "chunk 0") {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      inFlight -= 1

      const vectorsByText: Record<string, number[]> = {
        "chunk 0": [1, 0, 0],
        "chunk 1": [0, 1, 0],
        "chunk 2": [0, 0, 1],
        "chunk 3": [1, 1, 0],
      }
      return {
        ok: true,
        json: async () => ({
          data: body.input.map((text: string, index: number) => ({ index, embedding: vectorsByText[text] })),
        }),
      }
    })

    const { EmbeddingsRemote } = await import("./embeddings-remote.js")
    EmbeddingsRemote.configure({
      provider: "openai",
      embedModel: "qwen/qwen3-embedding-8b",
      embedDim: 3,
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "openrouter-key",
      batchSize: 2,
      concurrency: 2,
    })

    const vectors = await EmbeddingsRemote.embed(["chunk 0", "chunk 1", "chunk 2", "chunk 3"], { skipValidation: true })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(maxInFlight).toBe(2)
    expect(vectors[0]).toEqual([1, 0, 0])
    expect(vectors[1]).toEqual([0, 1, 0])
    expect(vectors[2]).toEqual([0, 0, 1])
    expect(vectors[3][0]).toBeCloseTo(Math.SQRT1_2)
    expect(vectors[3][1]).toBeCloseTo(Math.SQRT1_2)
  })

  it("retries retriable HTTP status codes", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        headers: { get: () => null },
        text: async () => "temporarily unavailable",
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ index: 0, embedding: [1, 0, 0] }] }),
      })
    const { EmbeddingsRemote } = await import("./embeddings-remote.js")
    EmbeddingsRemote.configure({
      provider: "openai",
      embedModel: "test-embedding",
      embedDim: 3,
      baseUrl: "http://127.0.0.1:1234/v1",
      apiKey: "test-key",
      rateLimit: { maxRetries: 1, retryBaseDelayMs: 1 },
    })

    await expect(EmbeddingsRemote.embed("retry me", { skipValidation: true })).resolves.toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("retries successful responses that omit batch embeddings", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ index: 0, embedding: [1, 0, 0] }] }),
      })
    const { EmbeddingsRemote } = await import("./embeddings-remote.js")
    EmbeddingsRemote.configure({
      provider: "openai",
      embedModel: "test-embedding",
      embedDim: 3,
      baseUrl: "http://127.0.0.1:1234/v1",
      apiKey: "test-key",
      rateLimit: { maxRetries: 1, retryBaseDelayMs: 1 },
    })

    await expect(EmbeddingsRemote.embed("retry malformed response", { skipValidation: true })).resolves.toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("passes the caller abort signal to fetch", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ index: 0, embedding: [1, 0, 0] }] }),
    })
    const controller = new AbortController()
    const { EmbeddingsRemote } = await import("./embeddings-remote.js")
    EmbeddingsRemote.configure({
      provider: "openai",
      embedModel: "test-embedding",
      embedDim: 3,
      baseUrl: "http://127.0.0.1:1234/v1",
      apiKey: "test-key",
    })

    await EmbeddingsRemote.embed("cancel me", { skipValidation: true, signal: controller.signal })

    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal)
  })

  it("keeps Qwen3 embedding inputs within the 32K token limit", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ index: 0, embedding: sizedVector(1024) }],
      }),
    })

    const { EmbeddingsRemote } = await import("./embeddings-remote.js")
    EmbeddingsRemote.configure({
      provider: "openai",
      embedModel: "qwen/qwen3-embedding-8b",
      embedDim: 1024,
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "openrouter-key",
    })

    const longText = "x".repeat(40_000)
    await EmbeddingsRemote.embed(longText)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)

    expect(body.input[0]).toHaveLength(40_000)
  })

  it("respects explicit maxInputTokens when validating OpenAI-compatible input", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ index: 0, embedding: sizedVector(1024) }],
      }),
    })

    const { EmbeddingsRemote } = await import("./embeddings-remote.js")
    EmbeddingsRemote.configure({
      provider: "openai",
      embedModel: "qwen/qwen3-embedding-8b",
      embedDim: 1024,
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "openrouter-key",
      maxInputTokens: 2048,
    })

    await EmbeddingsRemote.embed("x".repeat(10_000))
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)

    expect(body.input[0].length).toBeLessThan(10_000)
    expect(Math.ceil(body.input[0].length / 4)).toBeLessThanOrEqual(2048)
  })

  it("fails when OpenAI-compatible providers return fewer embeddings than requested", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ index: 0, embedding: [1, 0] }],
      }),
    })

    const { EmbeddingsRemote } = await import("./embeddings-remote.js")
    EmbeddingsRemote.configure({
      provider: "openai",
      embedModel: "test-embedding",
      embedDim: 2,
      baseUrl: "http://127.0.0.1:1234/v1",
      apiKey: "test-key",
      rateLimit: { maxRetries: 0 },
    })

    await expect(EmbeddingsRemote.embed(["one", "two"], { skipValidation: true })).rejects.toThrow(
      /returned 1 vectors for 2 inputs/,
    )
  })

  it("fails when OpenAI-compatible providers return the wrong vector dimension", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ index: 0, embedding: [1, 0] }],
      }),
    })

    const { EmbeddingsRemote } = await import("./embeddings-remote.js")
    EmbeddingsRemote.configure({
      provider: "openai",
      embedModel: "test-embedding",
      embedDim: 3,
      baseUrl: "http://127.0.0.1:1234/v1",
      apiKey: "test-key",
    })

    await expect(EmbeddingsRemote.embed("one", { skipValidation: true })).rejects.toThrow(
      /returned vector dimension 2/,
    )
  })
})

describe("EmbeddingsRemote Ollama", () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockMissingGlobalConfig()
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.doUnmock("node:fs")
    vi.unstubAllGlobals()
    delete process.env.SENSEGREP_PROVIDER
    delete process.env.SENSEGREP_EMBED_MODEL
    delete process.env.SENSEGREP_EMBED_DIM
    delete process.env.SENSEGREP_OLLAMA_BASE_URL
  })

  it("posts batches to Ollama's native embed endpoint without Authorization", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        embeddings: [
          sizedVector(1024, 3, 4),
          sizedVector(1024, 0, 5),
        ],
      }),
    })

    const { EmbeddingsRemote } = await import("./embeddings-remote.js")
    EmbeddingsRemote.configure({
      provider: "ollama",
      embedModel: "qwen3-embedding:0.6b",
      embedDim: 1024,
      baseUrl: "http://127.0.0.1:11434",
    })

    const vectors = await EmbeddingsRemote.embed(["find auth flow", "find billing"], { skipValidation: true })
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body)

    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:11434/api/embed")
    expect(init.headers.Authorization).toBeUndefined()
    expect(body).toEqual({
      model: "qwen3-embedding:0.6b",
      input: ["find auth flow", "find billing"],
    })
    expect(vectors[0][0]).toBeCloseTo(0.6)
    expect(vectors[0][1]).toBeCloseTo(0.8)
    expect(vectors[1][0]).toBeCloseTo(0)
    expect(vectors[1][1]).toBeCloseTo(1)
  })
})
