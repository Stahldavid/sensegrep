import { Log } from "../util/log.js"
import { getEmbeddingConfig, type EmbeddingConfig } from "./embedding-config.js"

const log = Log.create({ service: "semantic.chunk-limits" })

const CHARS_PER_TOKEN = 4
const MODEL_SAFETY_RATIO = 0.85
const CHUNKING_SIGNATURE_VERSION = 4

const CODE_TARGET_TOKENS = {
  simple: 1800,
  medium: 1200,
  complex: 800,
  max: 2200,
  min: 50,
  overlap: 96,
} as const

const SMALL_MODEL_TARGET_TOKENS = {
  simple: 1200,
  medium: 850,
  complex: 600,
  max: 1600,
  min: 50,
  overlap: 96,
} as const

export type GeneralChunkLimits = {
  max: number
  min: number
  overlap: number
  tokens: {
    modelMax: number
    usableModel: number
    max: number
    min: number
    overlap: number
  }
  charsPerToken: number
}

export type TreeSitterChunkLimits = GeneralChunkLimits & {
  statementOverlap: number
  config: {
    simple: number
    medium: number
    complex: number
  }
  tokenConfig: {
    simple: number
    medium: number
    complex: number
  }
}

export type ChunkingSignature = {
  version: number
  provider: EmbeddingConfig["provider"]
  model: string
  dimension: number
  maxInputTokens?: number
  modelMaxTokens: number
  usableModelTokens: number
  maxChars: number
  minChars: number
  overlapChars: number
  simpleChars: number
  mediumChars: number
  complexChars: number
}

let cachedGeneralLimits: GeneralChunkLimits | null = null
let cachedTreeSitterLimits: TreeSitterChunkLimits | null = null
let cachedConfigKey = ""

function tokensToChars(tokens: number): number {
  return Math.max(1, Math.floor(tokens * CHARS_PER_TOKEN))
}

function clampTokenTarget(target: number, usableModelTokens: number): number {
  return Math.max(1, Math.min(target, usableModelTokens))
}

function detectModelMaxTokens(config: EmbeddingConfig): number {
  if (config.maxInputTokens && Number.isFinite(config.maxInputTokens) && config.maxInputTokens > 0) {
    return Math.floor(config.maxInputTokens)
  }

  const model = config.embedModel.toLowerCase()
  if (model.includes("qwen3-embedding") || model.includes("qwen3_embedding")) return 32_768
  if (model.includes("text-embedding-3") || model.includes("text-embedding-ada")) return 8191
  if (model.includes("cohere.embed") || model.includes("embed-v4")) return 8192
  if (config.provider === "gemini") return 2048
  if (config.provider === "ollama") return 32_768
  return 8192
}

function buildLimits(config: EmbeddingConfig): TreeSitterChunkLimits {
  const modelMax = detectModelMaxTokens(config)
  const usableModel = Math.max(1, Math.floor(modelMax * MODEL_SAFETY_RATIO))
  const targets = usableModel < CODE_TARGET_TOKENS.max ? SMALL_MODEL_TARGET_TOKENS : CODE_TARGET_TOKENS

  const maxTokens = clampTokenTarget(targets.max, usableModel)
  const minTokens = Math.min(targets.min, maxTokens)
  const simpleTokens = clampTokenTarget(targets.simple, maxTokens)
  const mediumTokens = clampTokenTarget(targets.medium, maxTokens)
  const complexTokens = clampTokenTarget(targets.complex, maxTokens)
  const overlapTokens = Math.max(1, Math.min(targets.overlap, Math.floor(maxTokens * 0.15)))

  return {
    max: tokensToChars(maxTokens),
    min: tokensToChars(minTokens),
    overlap: tokensToChars(overlapTokens),
    statementOverlap: 3,
    charsPerToken: CHARS_PER_TOKEN,
    tokens: {
      modelMax,
      usableModel,
      max: maxTokens,
      min: minTokens,
      overlap: overlapTokens,
    },
    config: {
      simple: tokensToChars(simpleTokens),
      medium: tokensToChars(mediumTokens),
      complex: tokensToChars(complexTokens),
    },
    tokenConfig: {
      simple: simpleTokens,
      medium: mediumTokens,
      complex: complexTokens,
    },
  }
}

function configCacheKey(config: EmbeddingConfig): string {
  return [
    config.provider,
    config.embedModel,
    config.embedDim,
    config.maxInputTokens ?? "",
  ].join("\0")
}

function buildSignature(config: EmbeddingConfig, limits: TreeSitterChunkLimits): ChunkingSignature {
  return {
    version: CHUNKING_SIGNATURE_VERSION,
    provider: config.provider,
    model: config.embedModel,
    dimension: config.embedDim,
    ...(config.maxInputTokens ? { maxInputTokens: Math.floor(config.maxInputTokens) } : {}),
    modelMaxTokens: limits.tokens.modelMax,
    usableModelTokens: limits.tokens.usableModel,
    maxChars: limits.max,
    minChars: limits.min,
    overlapChars: limits.overlap,
    simpleChars: limits.config.simple,
    mediumChars: limits.config.medium,
    complexChars: limits.config.complex,
  }
}

function detectChunkLimits(config = getEmbeddingConfig()): TreeSitterChunkLimits {
  try {
    const limits = buildLimits(config)
    log.info("chunk limits provider detected", {
      provider: config.provider,
      model: config.embedModel,
      modelMaxTokens: limits.tokens.modelMax,
      maxChars: limits.max,
      envProvider: process.env.SENSEGREP_PROVIDER,
    })
    return limits
  } catch (error) {
    log.warn("failed to detect embedding chunk limits, using fallback", { error: String(error) })
    return buildLimits({
      provider: "openai",
      embedModel: "text-embedding-3-small",
      embedDim: 1536,
    })
  }
}

function refreshCachedLimits(config = getEmbeddingConfig()): TreeSitterChunkLimits {
  const key = configCacheKey(config)
  if (!cachedTreeSitterLimits || cachedConfigKey !== key) {
    cachedTreeSitterLimits = detectChunkLimits(config)
    cachedGeneralLimits = {
      max: cachedTreeSitterLimits.max,
      min: cachedTreeSitterLimits.min,
      overlap: cachedTreeSitterLimits.overlap,
      tokens: cachedTreeSitterLimits.tokens,
      charsPerToken: cachedTreeSitterLimits.charsPerToken,
    }
    cachedConfigKey = key
  }
  return cachedTreeSitterLimits
}

export function getEmbeddingModelMaxTokens(config: EmbeddingConfig = getEmbeddingConfig()): number {
  return detectModelMaxTokens(config)
}

export function getGeneralChunkLimits(): GeneralChunkLimits {
  refreshCachedLimits()
  if (!cachedGeneralLimits) throw new Error("Failed to initialize chunk limits")
  return cachedGeneralLimits
}

export function getTreeSitterChunkLimits(): TreeSitterChunkLimits {
  return refreshCachedLimits()
}

export function getChunkingSignature(config: EmbeddingConfig = getEmbeddingConfig()): ChunkingSignature {
  return buildSignature(config, buildLimits(config))
}
