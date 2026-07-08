import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime"
import { Log } from "../util/log.js"
import {
  getEmbeddingConfig,
  configureEmbedding,
  withEmbeddingConfig,
  type EmbeddingConfig,
  type EmbeddingOverrides,
} from "./embedding-config.js"

const log = Log.create({ service: "semantic.embeddings-remote" })

// ── Rate limiter ─────────────────────────────────────────────────────────────

/** Sliding-window rate limiter (1-minute window). */
class RateLimiter {
  private requestTs: number[] = []
  private tokenBucket: Array<{ ts: number; tokens: number }> = []

  constructor(
    private readonly rpm: number,
    private readonly tpm: number,
  ) {}

  private purge(now: number): void {
    const cutoff = now - 60_000
    while (this.requestTs.length > 0 && this.requestTs[0] <= cutoff) this.requestTs.shift()
    while (this.tokenBucket.length > 0 && this.tokenBucket[0].ts <= cutoff) this.tokenBucket.shift()
  }

  private usedTokens(): number {
    return this.tokenBucket.reduce((s, e) => s + e.tokens, 0)
  }

  async acquire(estimatedTokens: number): Promise<void> {
    while (true) {
      const now = Date.now()
      this.purge(now)

      const rpmOk = this.requestTs.length < this.rpm
      const tpmOk = this.usedTokens() + estimatedTokens <= this.tpm

      if (rpmOk && tpmOk) {
        this.requestTs.push(now)
        this.tokenBucket.push({ ts: now, tokens: estimatedTokens })
        return
      }

      let waitMs = 500
      if (!rpmOk && this.requestTs[0]) waitMs = Math.max(waitMs, this.requestTs[0] + 60_000 - now + 50)
      if (!tpmOk && this.tokenBucket[0]) waitMs = Math.max(waitMs, this.tokenBucket[0].ts + 60_000 - now + 50)

      log.info(`Rate limit: waiting ${Math.ceil(waitMs / 1000)}s`, {
        requests: this.requestTs.length,
        rpm: this.rpm,
        tokens: this.usedTokens(),
        tpm: this.tpm,
      })
      await new Promise<void>((r) => setTimeout(r, waitMs))
    }
  }
}

// Singleton keyed by rpm+tpm so config changes rebuild it.
let _limiter: RateLimiter | null = null
let _limiterKey = ""

function getLimiter(config: EmbeddingConfig): RateLimiter {
  // Default free-tier limits for Gemini Embedding models
  const DEFAULT_RPM = config.provider === "gemini" ? 3_000 : Infinity
  const DEFAULT_TPM = config.provider === "gemini" ? 1_000_000 : Infinity

  const rpm = config.rateLimit?.rpm ?? DEFAULT_RPM
  const tpm = config.rateLimit?.tpm ?? DEFAULT_TPM
  const key = `${rpm}:${tpm}`

  if (!_limiter || _limiterKey !== key) {
    _limiter = new RateLimiter(rpm, tpm)
    _limiterKey = key
  }
  return _limiter
}

// ── Retry helper ─────────────────────────────────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>, maxRetries: number, baseDelayMs: number, label: string): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      const message = typeof err?.message === "string" ? err.message : ""
      const statusCode = err?.$metadata?.httpStatusCode
      const isRetriable =
        statusCode === 429 ||
        statusCode === 500 ||
        statusCode === 502 ||
        statusCode === 503 ||
        statusCode === 504 ||
        err?.name === "ThrottlingException" ||
        err?.name === "TooManyRequestsException" ||
        err?.name === "ServiceUnavailableException" ||
        message.includes("429") ||
        message.includes("ThrottlingException") ||
        message.includes("ServiceUnavailableException")
      if (!isRetriable || attempt >= maxRetries) throw err
      const jitter = 0.5 + Math.random() * 0.5
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt) * jitter, 60_000)
      log.warn(`${label}: transient error, retry ${attempt + 1}/${maxRetries} in ${Math.ceil(delay / 1000)}s`, {
        statusCode,
        errorName: err?.name,
      })
      await new Promise<void>((r) => setTimeout(r, delay))
    }
  }
  /* istanbul ignore next */
  throw new Error("unreachable")
}

// ── Token limits ──────────────────────────────────────────────────────────────

const TOKEN_LIMITS = {
  gemini: 2048,
  openai: 8192,
  ollama: 32768,
  bedrock: 8192,
} as const

/** Bedrock Cohere rejects inputs above ~8k chars before server-side truncate applies. */
const BEDROCK_MAX_CHARS = 8192

const BEDROCK_DIMENSIONS = new Set([256, 512, 1024, 1536])

async function validateTextLength(
  text: string,
  provider: "gemini" | "openai" | "bedrock" | "ollama",
  _modelName: string,
): Promise<{ text: string; tokenCount: number; truncated: boolean }> {
  if (provider === "bedrock") {
    const tokenCount = Math.ceil(text.length / 4)
    if (text.length <= BEDROCK_MAX_CHARS) {
      return { text, tokenCount, truncated: false }
    }

    log.warn("Text exceeds Bedrock char limit, truncating", {
      textLength: text.length,
      limit: BEDROCK_MAX_CHARS,
    })
    return {
      text: text.substring(0, BEDROCK_MAX_CHARS),
      tokenCount: Math.ceil(BEDROCK_MAX_CHARS / 4),
      truncated: true,
    }
  }

  const limit =
    provider === "gemini"
      ? TOKEN_LIMITS.gemini
      : provider === "ollama"
        ? TOKEN_LIMITS.ollama
        : TOKEN_LIMITS.openai
  const tokenCount = Math.ceil(text.length / 4)

  if (tokenCount <= limit) {
    return { text, tokenCount, truncated: false }
  }

  log.warn("Text exceeds token limit, will be truncated", {
    provider,
    tokenCount,
    limit,
    textLength: text.length,
  })

  const safeLength = Math.floor((limit / tokenCount) * text.length * 0.95)
  return { text: text.substring(0, safeLength), tokenCount: limit, truncated: true }
}

function normalize(vec: number[]): number[] {
  let sum = 0
  for (const v of vec) sum += v * v
  const norm = Math.sqrt(sum)
  if (!Number.isFinite(norm) || norm <= 0) return vec
  return vec.map((v) => v / norm)
}

function batchTextsForBedrock(texts: string[]): string[][] {
  const maxItems = 96
  const maxBytes = 18 * 1024 * 1024
  const batches: string[][] = []
  let current: string[] = []
  let currentBytes = 512

  for (const text of texts) {
    const textBytes = Buffer.byteLength(text, "utf8") + 32
    const wouldOverflow =
      current.length > 0 &&
      (current.length >= maxItems || currentBytes + textBytes > maxBytes)

    if (wouldOverflow) {
      batches.push(current)
      current = []
      currentBytes = 512
    }

    current.push(text)
    currentBytes += textBytes
  }

  if (current.length > 0) batches.push(current)
  return batches.length > 0 ? batches : [[]]
}

function getLocalEmbeddingBatchSize(provider: "ollama"): number {
  const envName = "SENSEGREP_OLLAMA_BATCH_SIZE"
  const configured = process.env[envName] || process.env.SENSEGREP_EMBED_BATCH_SIZE
  if (configured) {
    const parsed = Number(configured)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`${envName}/SENSEGREP_EMBED_BATCH_SIZE must be a positive number, got "${configured}".`)
    }
    return Math.max(1, Math.floor(parsed))
  }

  // Local CPU servers often time out or reject large 64/256-item requests.
  // Keep requests small by default; hosted providers keep their larger batches.
  return 16
}

export namespace EmbeddingsRemote {
  const bedrockClients = new Map<string, BedrockRuntimeClient>()

  type TaskType =
    | "DEFAULT"
    | "RETRIEVAL_QUERY"
    | "RETRIEVAL_DOCUMENT"
    | "SEMANTIC_SIMILARITY"
    | "CLASSIFICATION"
    | "CLUSTERING"
    | "QUESTION_ANSWERING"
    | "FACT_VERIFICATION"
    | "CODE_RETRIEVAL_QUERY"

  type EmbedOptions = {
    taskType?: TaskType
    title?: string | string[]
    outputDimensionality?: number
  }

  export async function embed(
    texts: string | string[],
    options?: EmbedOptions & { skipValidation?: boolean },
  ): Promise<number[][]> {
    const input = Array.isArray(texts) ? texts : [texts]
    if (input.length === 0) return []

    const config = getEmbeddingConfig()
    if (config.provider === "gemini") {
      return embedGemini(input, options, config)
    }
    if (config.provider === "bedrock") {
      return embedBedrock(input, options, config)
    }
    if (config.provider === "ollama") {
      return embedOllama(input, options, config)
    }
    return embedOpenAI(input, options, config)
  }

  function getBedrockClient(config: EmbeddingConfig): BedrockRuntimeClient {
    const key = `${config.region || "__default__"}:${config.apiKey || "__no_token__"}`
    const existing = bedrockClients.get(key)
    if (existing) return existing

    const clientConfig: ConstructorParameters<typeof BedrockRuntimeClient>[0] = {}
    if (config.region) clientConfig.region = config.region
    if (config.apiKey) {
      clientConfig.token = { token: config.apiKey }
      clientConfig.authSchemePreference = ["httpBearerAuth"]
    }

    const client = new BedrockRuntimeClient(clientConfig)
    bedrockClients.set(key, client)
    return client
  }

  function getBedrockInputType(taskType?: TaskType): "search_document" | "search_query" | "classification" | "clustering" {
    switch (taskType) {
      case "RETRIEVAL_QUERY":
      case "CODE_RETRIEVAL_QUERY":
        return "search_query"
      case "CLASSIFICATION":
        return "classification"
      case "CLUSTERING":
        return "clustering"
      default:
        return "search_document"
    }
  }

  function parseBedrockFloatEmbeddings(data: any): any[] {
    if (Array.isArray(data?.embeddings)) return data.embeddings
    if (Array.isArray(data?.embeddings?.float)) return data.embeddings.float
    return []
  }

  async function embedBedrock(
    texts: string[],
    options: (EmbedOptions & { skipValidation?: boolean }) | undefined,
    config: EmbeddingConfig,
  ): Promise<number[][]> {
    const model = config.embedModel
    const outputDimensionality = Number(config.embedDim || options?.outputDimensionality || 1536)
    if (!BEDROCK_DIMENSIONS.has(outputDimensionality)) {
      throw new Error(
        `Amazon Bedrock Cohere Embed v4 requires --embed-dim to be one of 256, 512, 1024, or 1536. Received: ${outputDimensionality}.`,
      )
    }

    let validatedTexts: string[]
    if (options?.skipValidation) {
      validatedTexts = texts
    } else {
      validatedTexts = []
      let truncatedCount = 0
      for (const text of texts) {
        const validated = await validateTextLength(text, "bedrock", model)
        validatedTexts.push(validated.text)
        if (validated.truncated) truncatedCount++
      }

      if (truncatedCount > 0) {
        log.warn(`Truncated ${truncatedCount}/${texts.length} texts to fit token limit`, {
          model,
          limit: TOKEN_LIMITS.bedrock,
        })
      }
    }

    const batches = batchTextsForBedrock(validatedTexts)
    const allVectors: number[][] = []
    const limiter = getLimiter(config)
    const maxRetries = config.rateLimit?.maxRetries ?? 6
    const retryBaseDelayMs = config.rateLimit?.retryBaseDelayMs ?? 1_000
    const client = getBedrockClient(config)
    const inputType = getBedrockInputType(options?.taskType)

    for (const batch of batches) {
      if (batch.length === 0) continue
      const estimatedTokens = batch.reduce((s, t) => s + Math.ceil(t.length / 4), 0)
      await limiter.acquire(estimatedTokens)

      const data = await withRetry(
        async () => {
          const response = await client.send(
            new InvokeModelCommand({
              modelId: model,
              accept: "application/json",
              contentType: "application/json",
              body: JSON.stringify({
                texts: batch,
                input_type: inputType,
                embedding_types: ["float"],
                output_dimension: outputDimensionality,
                truncate: "RIGHT",
                max_tokens: TOKEN_LIMITS.bedrock,
              }),
            }),
          )

          const decoded = new TextDecoder().decode(response.body)
          return JSON.parse(decoded) as any
        },
        maxRetries,
        retryBaseDelayMs,
        "Bedrock",
      )

      const embeddings = parseBedrockFloatEmbeddings(data)
      const vectors = embeddings.map((embedding) => {
        if (!Array.isArray(embedding)) return []
        return normalize(embedding.map((value: any) => Number(value)))
      })

      allVectors.push(...vectors)
    }

    if (allVectors.length !== texts.length) {
      log.warn("bedrock embeddings count mismatch", { expected: texts.length, got: allVectors.length })
    }

    return allVectors
  }

  async function embedGemini(
    texts: string[],
    options: (EmbedOptions & { skipValidation?: boolean }) | undefined,
    config: EmbeddingConfig,
  ): Promise<number[][]> {
    const apiKey =
      config.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
    if (!apiKey) {
      throw new Error(
        "Gemini embeddings requested but no API key was found. " +
          "Set GEMINI_API_KEY or GOOGLE_API_KEY, or add \"apiKey\" to ~/.config/sensegrep/config.json.",
      )
    }

    const model = config.embedModel
    const outputDimensionality = Number(config.embedDim || options?.outputDimensionality || 768)
    const taskType = options?.taskType
    const titles = typeof options?.title === "string" ? texts.map(() => options.title as string) : options?.title

    let validatedTexts: string[]
    if (options?.skipValidation) {
      validatedTexts = texts
    } else {
      validatedTexts = []
      let truncatedCount = 0
      for (const text of texts) {
        const validated = await validateTextLength(text, "gemini", model)
        validatedTexts.push(validated.text)
        if (validated.truncated) truncatedCount++
      }

      if (truncatedCount > 0) {
        log.warn(`Truncated ${truncatedCount}/${texts.length} texts to fit token limit`, {
          model,
          limit: TOKEN_LIMITS.gemini,
        })
      }
    }

    const batchSize = 64
    const allVectors: number[][] = []
    const limiter = getLimiter(config)
    const maxRetries = config.rateLimit?.maxRetries ?? 6
    const retryBaseDelayMs = config.rateLimit?.retryBaseDelayMs ?? 1_000

    for (let i = 0; i < validatedTexts.length; i += batchSize) {
      const batchTexts = validatedTexts.slice(i, i + batchSize)
      const batchTitles = Array.isArray(titles) ? titles.slice(i, i + batchSize) : undefined
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents`

      const requests = batchTexts.map((text, idx) => {
        const req: Record<string, unknown> = {
          model: `models/${model}`,
          content: {
            parts: [{ text }],
          },
        }
        if (taskType) req.taskType = taskType
        if (Number.isFinite(outputDimensionality) && outputDimensionality > 0) {
          req.outputDimensionality = outputDimensionality
        }

        const title = batchTitles ? batchTitles[idx] : undefined
        if (title && taskType === "RETRIEVAL_DOCUMENT") req.title = title
        return req
      })

      const estimatedTokens = batchTexts.reduce((s, t) => s + Math.ceil(t.length / 4), 0)
      await limiter.acquire(estimatedTokens)

      const data = await withRetry(
        async () => {
          const resp = await fetch(url, {
            method: "POST",
            headers: {
              "x-goog-api-key": apiKey,
              "content-type": "application/json",
            },
            body: JSON.stringify({ requests }),
          })
          if (!resp.ok) {
            const text = await resp.text().catch(() => "")
            throw new Error(`Gemini embeddings request failed (${resp.status}): ${text || resp.statusText}`)
          }
          return resp.json().catch(() => ({})) as Promise<any>
        },
        maxRetries,
        retryBaseDelayMs,
        "Gemini",
      )

      const embeddings: any[] = Array.isArray(data.embeddings)
        ? data.embeddings
        : data.embedding
          ? [data.embedding]
          : Array.isArray(data.embeddings?.embeddings)
            ? data.embeddings.embeddings
            : []

      const vectors = embeddings.map((embedding) => {
        const values = embedding?.values
        if (!Array.isArray(values)) return []
        return normalize(values.map((value: any) => Number(value)))
      })

      allVectors.push(...vectors)
    }

    if (allVectors.length !== texts.length) {
      log.warn("gemini embeddings count mismatch", { expected: texts.length, got: allVectors.length })
    }

    return allVectors
  }

  async function embedOpenAI(
    texts: string[],
    options: (EmbedOptions & { skipValidation?: boolean }) | undefined,
    config: EmbeddingConfig,
  ): Promise<number[][]> {
    const apiKey =
      config.apiKey ||
      process.env.SENSEGREP_OPENAI_API_KEY ||
      process.env.FIREWORKS_API_KEY ||
      process.env.OPENAI_API_KEY
    if (!apiKey) {
      throw new Error(
        "OpenAI-compatible embeddings requested but no API key found. " +
          "Set SENSEGREP_OPENAI_API_KEY, FIREWORKS_API_KEY, or OPENAI_API_KEY, " +
          "or add \"apiKey\" to ~/.config/sensegrep/config.json.",
      )
    }

    const model = config.embedModel
    const baseUrl = config.baseUrl || "https://api.fireworks.ai/inference/v1"
    const outputDimensionality = Number(config.embedDim || options?.outputDimensionality || 768)

    let validatedTexts: string[]
    if (options?.skipValidation) {
      validatedTexts = texts
    } else {
      validatedTexts = []
      let truncatedCount = 0
      for (const text of texts) {
        const validated = await validateTextLength(text, "openai", model)
        validatedTexts.push(validated.text)
        if (validated.truncated) truncatedCount++
      }

      if (truncatedCount > 0) {
        log.warn(`Truncated ${truncatedCount}/${texts.length} texts to fit token limit`, {
          model,
          limit: TOKEN_LIMITS.openai,
        })
      }
    }

    const batchSize = 64
    const allVectors: number[][] = []
    const limiter = getLimiter(config)
    const maxRetries = config.rateLimit?.maxRetries ?? 6
    const retryBaseDelayMs = config.rateLimit?.retryBaseDelayMs ?? 1_000

    for (let i = 0; i < validatedTexts.length; i += batchSize) {
      const batch = validatedTexts.slice(i, i + batchSize)
      const url = `${baseUrl.replace(/\/+$/, "")}/embeddings`
      const body: Record<string, unknown> = {
        model,
        input: batch,
      }
      if (Number.isFinite(outputDimensionality) && outputDimensionality > 0) {
        body.dimensions = outputDimensionality
      }

      const estimatedTokens = batch.reduce((s, t) => s + Math.ceil(t.length / 4), 0)
      await limiter.acquire(estimatedTokens)

      const data = await withRetry(
        async () => {
          const resp = await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          })
          if (!resp.ok) {
            const text = await resp.text().catch(() => "")
            throw new Error(`OpenAI-compatible embeddings request failed (${resp.status}): ${text || resp.statusText}`)
          }
          return resp.json().catch(() => ({})) as Promise<any>
        },
        maxRetries,
        retryBaseDelayMs,
        "OpenAI",
      )

      const embeddings: any[] = Array.isArray(data.data) ? data.data : []
      embeddings.sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0))

      const vectors = embeddings.map((embedding) => {
        const values = embedding?.embedding
        if (!Array.isArray(values)) return []
        return normalize(values.map((value: any) => Number(value)))
      })

      allVectors.push(...vectors)
    }

    if (allVectors.length !== texts.length) {
      log.warn("OpenAI-compatible embeddings count mismatch", { expected: texts.length, got: allVectors.length })
    }

    return allVectors
  }

  async function embedOllama(
    texts: string[],
    options: (EmbedOptions & { skipValidation?: boolean }) | undefined,
    config: EmbeddingConfig,
  ): Promise<number[][]> {
    const model = config.embedModel
    const baseUrl = config.baseUrl || "http://127.0.0.1:11434"

    let validatedTexts: string[]
    if (options?.skipValidation) {
      validatedTexts = texts
    } else {
      validatedTexts = []
      let truncatedCount = 0
      for (const text of texts) {
        const validated = await validateTextLength(text, "ollama", model)
        validatedTexts.push(validated.text)
        if (validated.truncated) truncatedCount++
      }

      if (truncatedCount > 0) {
        log.warn(`Truncated ${truncatedCount}/${texts.length} texts to fit token limit`, {
          model,
          limit: TOKEN_LIMITS.ollama,
        })
      }
    }

    const batchSize = getLocalEmbeddingBatchSize("ollama")
    const allVectors: number[][] = []
    const limiter = getLimiter(config)
    const maxRetries = config.rateLimit?.maxRetries ?? 6
    const retryBaseDelayMs = config.rateLimit?.retryBaseDelayMs ?? 1_000

    for (let i = 0; i < validatedTexts.length; i += batchSize) {
      const batch = validatedTexts.slice(i, i + batchSize)
      const url = `${baseUrl.replace(/\/+$/, "")}/api/embed`
      const estimatedTokens = batch.reduce((s, t) => s + Math.ceil(t.length / 4), 0)
      await limiter.acquire(estimatedTokens)

      const data = await withRetry(
        async () => {
          const resp = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ model, input: batch }),
          })
          if (!resp.ok) {
            const text = await resp.text().catch(() => "")
            throw new Error(`Ollama embeddings request failed (${resp.status}): ${text || resp.statusText}`)
          }
          return resp.json().catch(() => ({})) as Promise<any>
        },
        maxRetries,
        retryBaseDelayMs,
        "Ollama",
      )

      const embeddings: any[] = Array.isArray(data.embeddings)
        ? data.embeddings
        : Array.isArray(data.embedding)
          ? [data.embedding]
          : []

      const vectors = embeddings.map((embedding) => {
        if (!Array.isArray(embedding)) return []
        return normalize(embedding.map((value: any) => Number(value)))
      })

      allVectors.push(...vectors)
    }

    if (allVectors.length !== texts.length) {
      log.warn("Ollama embeddings count mismatch", { expected: texts.length, got: allVectors.length })
    }

    return allVectors
  }

  export async function rerank(_query: string, documents: string[]): Promise<{ index: number; score: number }[]> {
    if (documents.length === 0) return []
    log.warn("Reranking requested, but reranking is disabled in the remote-only build. Returning semantic order.")
    return documents.map((_, index) => ({
      index,
      score: documents.length - index,
    }))
  }

  export function getDimension(): number {
    return getEmbeddingConfig().embedDim
  }

  export function getProvider(): string {
    return getEmbeddingConfig().provider
  }

  export async function preload(): Promise<void> {
    log.info("remote-only embeddings mode; nothing to preload")
  }

  export async function getDevice(): Promise<string> {
    return "remote-api"
  }

  export function getModel(): string {
    return getEmbeddingConfig().embedModel
  }

  export function getRerankModel(): string {
    return "disabled"
  }

  export function getConfig(): EmbeddingConfig {
    return getEmbeddingConfig()
  }

  export function configure(overrides: EmbeddingOverrides) {
    configureEmbedding(overrides)
  }

  export async function withConfig<T>(overrides: EmbeddingOverrides, fn: () => Promise<T>): Promise<T> {
    return withEmbeddingConfig(overrides, fn)
  }
}
