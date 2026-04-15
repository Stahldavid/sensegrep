import fs from "node:fs"
import path from "node:path"
import { Global } from "../global/index.js"

type EmbeddingProvider = "gemini" | "openai"

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
  apiKey?: string
  rateLimit?: RateLimitConfig
}

export type EmbeddingOverrides = Partial<EmbeddingConfig>

const DEFAULTS = {
  geminiModel: "gemini-embedding-001",
  geminiDim: 768,
  openaiModel: "fireworks/qwen3-embedding-8b",
  openaiDim: 768,
  openaiBaseUrl: "https://api.fireworks.ai/inference/v1",
} as const

const CONFIG_FILENAME = "config.json"
let cachedFileConfig: Partial<EmbeddingConfig> | null = null
let runtimeOverrides: EmbeddingOverrides | null = null

function parseNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  const num = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(num) || num <= 0) return undefined
  return num
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
  if (normalized === "gemini" || normalized === "openai") return normalized
  throw new Error(`Unsupported embeddings provider in ${source}: "${value}". Use "gemini" or "openai".`)
}

function readProvider(): EmbeddingProvider {
  const envProvider = (process.env.SENSEGREP_PROVIDER || process.env.OPENCODE_SEMANTIC_EMBEDDINGS || "").toLowerCase()
  const configured = readConfiguredProvider(envProvider, "SENSEGREP_PROVIDER/OPENCODE_SEMANTIC_EMBEDDINGS")
  if (configured) return configured

  if (process.env.SENSEGREP_OPENAI_API_KEY || process.env.FIREWORKS_API_KEY) return "openai"
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) return "gemini"
  return "gemini"
}

export function configureEmbedding(overrides: EmbeddingOverrides) {
  runtimeOverrides = { ...(runtimeOverrides || {}), ...overrides }
}

export function clearEmbeddingOverrides() {
  runtimeOverrides = null
}

export function getEmbeddingConfig(overrides?: EmbeddingOverrides): EmbeddingConfig {
  const fileConfig = loadFileConfig()
  const mergedOverrides = { ...(runtimeOverrides || {}), ...(overrides || {}) }

  const provider =
    readConfiguredProvider(mergedOverrides.provider, "embedding overrides") ||
    readConfiguredProvider(process.env.SENSEGREP_PROVIDER, "SENSEGREP_PROVIDER") ||
    readConfiguredProvider(process.env.OPENCODE_SEMANTIC_EMBEDDINGS, "OPENCODE_SEMANTIC_EMBEDDINGS") ||
    readConfiguredProvider(fileConfig.provider, `${CONFIG_FILENAME} provider`) ||
    readProvider()

  const embedModel =
    mergedOverrides.embedModel ||
    process.env.SENSEGREP_EMBED_MODEL ||
    (fileConfig.embedModel as string | undefined) ||
    (provider === "gemini"
      ? process.env.OPENCODE_GEMINI_EMBED_MODEL || DEFAULTS.geminiModel
      : DEFAULTS.openaiModel)

  const embedDim =
    mergedOverrides.embedDim ??
    parseNumber(process.env.SENSEGREP_EMBED_DIM) ??
    parseNumber(fileConfig.embedDim) ??
    (provider === "gemini"
      ? parseNumber(process.env.OPENCODE_GEMINI_EMBED_DIM) ?? DEFAULTS.geminiDim
      : DEFAULTS.openaiDim)

  const baseUrl =
    mergedOverrides.baseUrl ||
    process.env.SENSEGREP_OPENAI_BASE_URL ||
    (fileConfig as any).baseUrl ||
    (provider === "openai" ? DEFAULTS.openaiBaseUrl : undefined)

  const apiKey =
    mergedOverrides.apiKey ||
    process.env.SENSEGREP_OPENAI_API_KEY ||
    process.env.FIREWORKS_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    (fileConfig as any).apiKey

  const rateLimit: RateLimitConfig = {}
  const fileRl = (fileConfig as any).rateLimit
  if (fileRl && typeof fileRl === "object") Object.assign(rateLimit, fileRl)
  const overrideRl = (mergedOverrides as any).rateLimit
  if (overrideRl && typeof overrideRl === "object") Object.assign(rateLimit, overrideRl)
  if (process.env.SENSEGREP_RATE_LIMIT_RPM) rateLimit.rpm = Number(process.env.SENSEGREP_RATE_LIMIT_RPM)
  if (process.env.SENSEGREP_RATE_LIMIT_TPM) rateLimit.tpm = Number(process.env.SENSEGREP_RATE_LIMIT_TPM)
  if (process.env.SENSEGREP_MAX_RETRIES) rateLimit.maxRetries = Number(process.env.SENSEGREP_MAX_RETRIES)
  if (process.env.SENSEGREP_RETRY_BASE_DELAY_MS) rateLimit.retryBaseDelayMs = Number(process.env.SENSEGREP_RETRY_BASE_DELAY_MS)

  const merged: EmbeddingConfig = {
    provider,
    embedModel,
    embedDim,
    ...(baseUrl ? { baseUrl } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(Object.keys(rateLimit).length > 0 ? { rateLimit } : {}),
  }

  return merged
}

export async function withEmbeddingConfig<T>(overrides: EmbeddingOverrides, fn: () => Promise<T>): Promise<T> {
  const previous = runtimeOverrides
  configureEmbedding(overrides)
  try {
    return await fn()
  } finally {
    runtimeOverrides = previous
  }
}

export function getEmbeddingOverrides(): EmbeddingOverrides | null {
  return runtimeOverrides
}
