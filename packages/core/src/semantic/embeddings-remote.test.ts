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
})
