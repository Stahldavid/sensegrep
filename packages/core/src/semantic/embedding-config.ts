import fs from "node:fs"
import path from "node:path"
import { Global } from "../global/index.js"

type EmbeddingProvider = "local" | "gemini" | "openai"
export type DeviceType = "cpu" | "cuda" | "webgpu" | "wasm"

export type EmbeddingConfig = {
  provider: EmbeddingProvider
  embedModel: string
  embedDim: number
  rerankModel: string
  device?: DeviceType
  baseUrl?: string
}

export type EmbeddingOverrides = Partial<EmbeddingConfig>

const DEFAULTS = {
  localModel: "BAAI/bge-small-en-v1.5",
  localDim: 384,
  geminiModel: "gemini-embedding-001",
  geminiDim: 768,
  openaiModel: "fireworks/qwen3-embedding-8b",
  openaiDim: 768,
  openaiBaseUrl: "https://api.fireworks.ai/inference/v1",
  rerankModel: "Xenova/ms-marco-MiniLM-L-6-v2",
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

function readProvider(): EmbeddingProvider {
  const envProvider = (process.env.SENSEGREP_PROVIDER || process.env.OPENCODE_SEMANTIC_EMBEDDINGS || "").toLowerCase()
  if (envProvider === "gemini") return "gemini"
  if (envProvider === "openai") return "openai"
  if (envProvider === "local") return "local"

  if (process.env.SENSEGREP_OPENAI_API_KEY || process.env.FIREWORKS_API_KEY) return "openai"
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) return "gemini"
  return "local"
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
    mergedOverrides.provider ||
    (process.env.SENSEGREP_PROVIDER as EmbeddingProvider | undefined) ||
    (fileConfig.provider as EmbeddingProvider | undefined) ||
    readProvider()

  const embedModel =
    mergedOverrides.embedModel ||
    process.env.SENSEGREP_EMBED_MODEL ||
    (fileConfig.embedModel as string | undefined) ||
    (provider === "gemini"
      ? process.env.OPENCODE_GEMINI_EMBED_MODEL || DEFAULTS.geminiModel
      : provider === "openai"
        ? DEFAULTS.openaiModel
        : DEFAULTS.localModel)

  const embedDim =
    mergedOverrides.embedDim ??
    parseNumber(process.env.SENSEGREP_EMBED_DIM) ??
    parseNumber(fileConfig.embedDim) ??
    (provider === "gemini"
      ? parseNumber(process.env.OPENCODE_GEMINI_EMBED_DIM) ?? DEFAULTS.geminiDim
      : provider === "openai"
        ? DEFAULTS.openaiDim
        : DEFAULTS.localDim)

  const rerankModel =
    mergedOverrides.rerankModel ||
    process.env.SENSEGREP_RERANK_MODEL ||
    (fileConfig.rerankModel as string | undefined) ||
    DEFAULTS.rerankModel

  const device =
    mergedOverrides.device ||
    (process.env.SENSEGREP_EMBED_DEVICE as DeviceType | undefined) ||
    (process.env.OPENCODE_EMBEDDINGS_DEVICE as DeviceType | undefined) ||
    (fileConfig.device as DeviceType | undefined)

  const baseUrl =
    mergedOverrides.baseUrl ||
    process.env.SENSEGREP_OPENAI_BASE_URL ||
    (fileConfig as any).baseUrl ||
    (provider === "openai" ? DEFAULTS.openaiBaseUrl : undefined)

  const merged: EmbeddingConfig = {
    provider,
    embedModel,
    embedDim,
    rerankModel,
    ...(device ? { device } : {}),
    ...(baseUrl ? { baseUrl } : {}),
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
