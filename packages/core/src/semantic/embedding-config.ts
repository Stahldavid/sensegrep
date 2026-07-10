import fs from "node:fs"
import path from "node:path"
import { AsyncLocalStorage } from "node:async_hooks"
import { Global } from "../global/index.js"

export type EmbeddingProvider = "gemini" | "openai" | "bedrock" | "ollama"

export type RateLimitConfig = {
  /** Max requests per minute. Default: 3000 (Gemini free tier). */
  rpm?: number
  /** Max tokens per minute. Default: 1_000_000 (Gemini free tier). */
  tpm?: number
  /** Max retries on 429. Default: 6. */
  maxRetries?: number
  /** Base delay (ms) for exponential backoff. Default: 1000. */
  retryBaseDelayMs?: number
}

export type EmbeddingConfig = {
  provider: EmbeddingProvider
  embedModel: string
  embedDim: number
  baseUrl?: string
  region?: string
  apiKey?: string
  batchSize?: number
  concurrency?: number
  maxInputTokens?: number
  openRouterReferer?: string
  openRouterTitle?: string
  rateLimit?: RateLimitConfig
}

export type EmbeddingOverrides = Partial<EmbeddingConfig>

export function embeddingConfigFingerprint(config: EmbeddingConfig): string {
  return JSON.stringify({
    provider: config.provider,
    model: config.embedModel,
    dimension: config.embedDim,
    baseUrl: config.baseUrl ?? "",
    region: config.region ?? "",
    maxInputTokens: config.maxInputTokens ?? null,
  })
}

const DEFAULTS = {
  geminiModel: "gemini-embedding-001",
  geminiDim: 768,
  openaiModel: "fireworks/qwen3-embedding-8b",
  openaiDim: 768,
  openaiBaseUrl: "https://api.fireworks.ai/inference/v1",
  ollamaModel: "qwen3-embedding:0.6b",
  ollamaDim: 1024,
  ollamaBaseUrl: "http://127.0.0.1:11434",
  bedrockModel: "cohere.embed-v4:0",
  bedrockDim: 1536,
} as const

const CONFIG_FILENAME = "config.json"
let cachedFileConfig: Partial<EmbeddingConfig> | null = null
let runtimeOverrides: EmbeddingOverrides | null = null
const scopedOverrides = new AsyncLocalStorage<EmbeddingOverrides>()

function parseNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  const num = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(num) || num <= 0) return undefined
  return num
}

function parsePositiveEnvNumber(name: string): number | undefined {
  const value = process.env[name]
  if (value === undefined || value === "") return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number, got "${value}".`)
  }
  return parsed
}

function loadFileConfig(): Partial<EmbeddingConfig> {
  if (cachedFileConfig) return cachedFileConfig
  const configPath = path.join(Global.Path.config, CONFIG_FILENAME)
  try {
    const raw = fs.readFileSync(configPath, "utf8")
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object") {
      cachedFileConfig = parsed as Partial<EmbeddingConfig>
      return cachedFileConfig
    }
  } catch (_) {
    // ignore missing or invalid config
  }
  cachedFileConfig = {}
  return cachedFileConfig
}

function readConfiguredProvider(value: unknown, source: string): EmbeddingProvider | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined
  const normalized = value.toLowerCase()
  if (normalized === "gemini" || normalized === "openai" || normalized === "bedrock" || normalized === "ollama") return normalized
  throw new Error(
    `Unsupported embeddings provider in ${source}: "${value}". Use "gemini", "openai", "bedrock", or "ollama".`,
  )
}

function readProvider(): EmbeddingProvider {
  const envProvider = (process.env.SENSEGREP_PROVIDER || process.env.OPENCODE_SEMANTIC_EMBEDDINGS || "").toLowerCase()
  const configured = readConfiguredProvider(envProvider, "SENSEGREP_PROVIDER/OPENCODE_SEMANTIC_EMBEDDINGS")
  if (configured) return configured

  if (process.env.SENSEGREP_OPENAI_API_KEY || process.env.FIREWORKS_API_KEY) return "openai"
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) return "gemini"
  return "ollama"
}

export function configureEmbedding(overrides: EmbeddingOverrides) {
  runtimeOverrides = { ...(runtimeOverrides || {}), ...overrides }
}

export function clearEmbeddingOverrides() {
  runtimeOverrides = null
}

export function getEmbeddingConfig(overrides?: EmbeddingOverrides): EmbeddingConfig {
  const fileConfig = loadFileConfig()
  const mergedOverrides = {
    ...(runtimeOverrides || {}),
    ...(scopedOverrides.getStore() || {}),
    ...(overrides || {}),
  }
  const fileProvider = readConfiguredProvider(fileConfig.provider, `${CONFIG_FILENAME} provider`)

  const provider =
    readConfiguredProvider(mergedOverrides.provider, "embedding overrides") ||
    readConfiguredProvider(process.env.SENSEGREP_PROVIDER, "SENSEGREP_PROVIDER") ||
    readConfiguredProvider(process.env.OPENCODE_SEMANTIC_EMBEDDINGS, "OPENCODE_SEMANTIC_EMBEDDINGS") ||
    fileProvider ||
    readProvider()

  const fileConfigApplies = !fileProvider || fileProvider === provider

  const embedModel =
    mergedOverrides.embedModel ||
    process.env.SENSEGREP_EMBED_MODEL ||
    (fileConfigApplies ? (fileConfig.embedModel as string | undefined) : undefined) ||
    (provider === "gemini"
      ? process.env.OPENCODE_GEMINI_EMBED_MODEL || DEFAULTS.geminiModel
      : provider === "openai"
        ? DEFAULTS.openaiModel
        : provider === "ollama"
          ? DEFAULTS.ollamaModel
          : DEFAULTS.bedrockModel)

  const embedDim =
    mergedOverrides.embedDim ??
    parseNumber(process.env.SENSEGREP_EMBED_DIM) ??
    (fileConfigApplies ? parseNumber(fileConfig.embedDim) : undefined) ??
    (provider === "gemini"
      ? parseNumber(process.env.OPENCODE_GEMINI_EMBED_DIM) ?? DEFAULTS.geminiDim
      : provider === "openai"
        ? DEFAULTS.openaiDim
        : provider === "ollama"
          ? DEFAULTS.ollamaDim
          : DEFAULTS.bedrockDim)

  const baseUrl =
    mergedOverrides.baseUrl ||
    (provider === "ollama" ? process.env.SENSEGREP_OLLAMA_BASE_URL : undefined) ||
    process.env.SENSEGREP_OPENAI_BASE_URL ||
    (fileConfigApplies ? (fileConfig as any).baseUrl : undefined) ||
    (provider === "openai"
      ? DEFAULTS.openaiBaseUrl
      : provider === "ollama"
        ? DEFAULTS.ollamaBaseUrl
        : undefined)

  const region =
    mergedOverrides.region ||
    process.env.SENSEGREP_BEDROCK_REGION ||
    (fileConfigApplies ? (fileConfig as any).region : undefined) ||
    (provider === "bedrock" ? process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION : undefined)

  const batchSize =
    mergedOverrides.batchSize ??
    (provider === "openai" ? parsePositiveEnvNumber("SENSEGREP_OPENAI_BATCH_SIZE") : undefined) ??
    (fileConfigApplies ? parseNumber((fileConfig as any).batchSize) : undefined)

  const concurrency =
    mergedOverrides.concurrency ??
    (provider === "openai" ? parsePositiveEnvNumber("SENSEGREP_OPENAI_CONCURRENCY") : undefined) ??
    parsePositiveEnvNumber("SENSEGREP_EMBED_CONCURRENCY") ??
    (fileConfigApplies ? parseNumber((fileConfig as any).concurrency) : undefined)

  const maxInputTokens =
    mergedOverrides.maxInputTokens ??
    parsePositiveEnvNumber("SENSEGREP_EMBED_MAX_TOKENS") ??
    (fileConfigApplies ? parseNumber((fileConfig as any).maxInputTokens) : undefined)

  const openRouterReferer =
    (mergedOverrides as any).openRouterReferer ||
    process.env.SENSEGREP_OPENROUTER_REFERER ||
    (fileConfigApplies ? (fileConfig as any).openRouterReferer : undefined)

  const openRouterTitle =
    (mergedOverrides as any).openRouterTitle ||
    process.env.SENSEGREP_OPENROUTER_TITLE ||
    (fileConfigApplies ? (fileConfig as any).openRouterTitle : undefined)

  const fileApiKey = fileConfigApplies ? ((fileConfig as any).apiKey as string | undefined) : undefined
  const apiKey =
    mergedOverrides.apiKey ||
    (provider === "openai"
      ? process.env.SENSEGREP_OPENAI_API_KEY ||
        process.env.FIREWORKS_API_KEY ||
        process.env.OPENAI_API_KEY ||
        fileApiKey
      : provider === "gemini"
        ? process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || fileApiKey
      : provider === "bedrock"
          ? process.env.SENSEGREP_BEDROCK_API_KEY || fileApiKey
          : undefined)

  const rateLimit: RateLimitConfig = {}
  const fileRl = (fileConfig as any).rateLimit
  if (fileRl && typeof fileRl === "object") Object.assign(rateLimit, fileRl)
  const overrideRl = (mergedOverrides as any).rateLimit
  if (overrideRl && typeof overrideRl === "object") Object.assign(rateLimit, overrideRl)
  if (process.env.SENSEGREP_RATE_LIMIT_RPM) rateLimit.rpm = parsePositiveEnvNumber("SENSEGREP_RATE_LIMIT_RPM")
  if (process.env.SENSEGREP_RATE_LIMIT_TPM) rateLimit.tpm = parsePositiveEnvNumber("SENSEGREP_RATE_LIMIT_TPM")
  if (process.env.SENSEGREP_MAX_RETRIES) rateLimit.maxRetries = parsePositiveEnvNumber("SENSEGREP_MAX_RETRIES")
  if (process.env.SENSEGREP_RETRY_BASE_DELAY_MS) rateLimit.retryBaseDelayMs = parsePositiveEnvNumber("SENSEGREP_RETRY_BASE_DELAY_MS")

  const merged: EmbeddingConfig = {
    provider,
    embedModel,
    embedDim,
    ...((provider === "openai" || provider === "ollama") && baseUrl ? { baseUrl } : {}),
    ...(provider === "bedrock" && region ? { region } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(batchSize ? { batchSize } : {}),
    ...(concurrency ? { concurrency } : {}),
    ...(maxInputTokens ? { maxInputTokens } : {}),
    ...(provider === "openai" && openRouterReferer ? { openRouterReferer } : {}),
    ...(provider === "openai" && openRouterTitle ? { openRouterTitle } : {}),
    ...(Object.keys(rateLimit).length > 0 ? { rateLimit } : {}),
  }

  return merged
}

export async function withEmbeddingConfig<T>(overrides: EmbeddingOverrides, fn: () => Promise<T>): Promise<T> {
  const inherited = scopedOverrides.getStore()
  return scopedOverrides.run({ ...(inherited || {}), ...overrides }, fn)
}

export function getEmbeddingOverrides(): EmbeddingOverrides | null {
  return scopedOverrides.getStore() ?? runtimeOverrides
}
