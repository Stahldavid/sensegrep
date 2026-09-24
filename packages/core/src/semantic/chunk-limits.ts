import { tokenCounterIdentity } from "./token-count.js"
import { getEmbeddingConfig, type EmbeddingConfig } from "./embedding-config.js"

const CHARS_PER_TOKEN = 4
const CHUNKING_SIGNATURE_VERSION = 6

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
  targetTokens: number
  preserveTokens: number
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
  targetTokens: number
  preserveTokens: number
  contextTokens: number
  tokenizer: string
}

let cachedGeneralLimits: GeneralChunkLimits | null = null
let cachedTreeSitterLimits: TreeSitterChunkLimits | null = null
let cachedConfigKey = ""

function tokensToChars(tokens: number): number {
  return Math.max(1, Math.floor(tokens * CHARS_PER_TOKEN))
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
  if (config.provider === "ollama") return 2048
  return 8192
}

export function getOperationalContextTokens(config: EmbeddingConfig = getEmbeddingConfig()): number {
  const capacity = detectModelMaxTokens(config)
  return Math.min(capacity, config.contextTokens ?? (config.provider === "ollama" ? 8192 : capacity))
}

function buildLimits(config: EmbeddingConfig): TreeSitterChunkLimits {
  const modelMax = detectModelMaxTokens(config)
  const context = getOperationalContextTokens(config)
  // Reserve room for provider special tokens, including EOS; count metadata as input.
  const usableModel = Math.max(1, context - Math.max(32, Math.ceil(context * 0.02)))
  const maxTokens = Math.min(config.chunking?.maxTokens ?? 7000, usableModel, config.provider === "bedrock" ? 2000 : Infinity)
  const preserveTokens = Math.min(config.chunking?.preserveTokens ?? 4096, maxTokens)
  const targetTokens = Math.min(config.chunking?.targetTokens ?? 2048, preserveTokens)
  const overlapTokens = Math.min(config.chunking?.overlapTokens ?? 128, Math.floor(targetTokens * 0.15))
  return {
    max: tokensToChars(maxTokens), min: tokensToChars(Math.min(50, targetTokens)),
    overlap: tokensToChars(overlapTokens), targetTokens, preserveTokens,
    statementOverlap: 3, charsPerToken: CHARS_PER_TOKEN,
    tokens: { modelMax, usableModel, max: maxTokens, min: Math.min(50, targetTokens), overlap: overlapTokens },
    // Compatibility for language chunkers. Complexity no longer reduces context.
    config: { simple: tokensToChars(preserveTokens), medium: tokensToChars(preserveTokens), complex: tokensToChars(preserveTokens) },
    tokenConfig: { simple: preserveTokens, medium: preserveTokens, complex: preserveTokens },
  }
}

function configCacheKey(config: EmbeddingConfig): string {
  return [
    config.provider,
    config.embedModel,
    config.embedDim,
    config.maxInputTokens ?? "",
    config.contextTokens ?? "",
    JSON.stringify(config.chunking ?? {}),
    tokenCounterIdentity(config),
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
    targetTokens: limits.targetTokens,
    preserveTokens: limits.preserveTokens,
    contextTokens: getOperationalContextTokens(config),
    tokenizer: tokenCounterIdentity(config),
  }
}

function detectChunkLimits(config = getEmbeddingConfig()): TreeSitterChunkLimits {
  return buildLimits(config)
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
      targetTokens: cachedTreeSitterLimits.targetTokens,
      preserveTokens: cachedTreeSitterLimits.preserveTokens,
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
