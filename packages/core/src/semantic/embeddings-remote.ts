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
      const is429 = typeof err?.message === "string" && err.message.includes("429")
      if (!is429 || attempt >= maxRetries) throw err
      const jitter = 0.5 + Math.random() * 0.5
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt) * jitter, 60_000)
      log.warn(`${label}: 429 rate limited, retry ${attempt + 1}/${maxRetries} in ${Math.ceil(delay / 1000)}s`)
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
} as const

async function countTokensGemini(text: string, modelName: string): Promise<number> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
  if (!apiKey) {
    log.warn("No Gemini API key, using character estimate for token count")
    return Math.ceil(text.length / 4)
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:countTokens`
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
      }),
    })

    if (!response.ok) {
      throw new Error(`Gemini countTokens failed: ${response.statusText}`)
    }

    const data = (await response.json()) as { totalTokens?: number }
    return data.totalTokens || 0
  } catch (error) {
    log.warn("Failed to count tokens with Gemini API, using character estimate", { error })
    return Math.ceil(text.length / 4)
  }
}

async function validateTextLength(
  text: string,
  provider: "gemini" | "openai",
  modelName: string,
): Promise<{ text: string; tokenCount: number; truncated: boolean }> {
  const limit = provider === "gemini" ? TOKEN_LIMITS.gemini : TOKEN_LIMITS.openai
  const tokenCount =
    provider === "gemini" ? await countTokensGemini(text, modelName) : Math.ceil(text.length / 4)

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

export namespace EmbeddingsRemote {
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
    return embedOpenAI(input, options, config)
  }

  async function embedGemini(
    texts: string[],
    options: (EmbedOptions & { skipValidation?: boolean }) | undefined,
    config: EmbeddingConfig,
  ): Promise<number[][]> {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
    if (!apiKey) {
      throw new Error(
        "Gemini embeddings requested but GEMINI_API_KEY (or GOOGLE_API_KEY) is not set.",
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
      process.env.SENSEGREP_OPENAI_API_KEY ||
      process.env.FIREWORKS_API_KEY ||
      process.env.OPENAI_API_KEY
    if (!apiKey) {
      throw new Error(
        "OpenAI-compatible embeddings requested but no API key found. " +
          "Set SENSEGREP_OPENAI_API_KEY, FIREWORKS_API_KEY, or OPENAI_API_KEY.",
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
