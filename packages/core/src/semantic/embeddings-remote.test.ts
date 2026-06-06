import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const sendMock = vi.fn()
const clientCtor = vi.fn()

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
    return {
      ...actual,
      readFileSync: vi.fn(() => {
        throw new Error("ENOENT")
      }),
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
          embeddings: [[3, 4]],
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
            float: [[1, 2, 2]],
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
          embeddings: [[1, 0]],
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
    delete process.env.FIREWORKS_API_KEY
    delete process.env.OPENAI_API_KEY
  })

  it("uses apiKey from embedding config without environment variables", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ index: 0, embedding: [3, 4] }],
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
})
