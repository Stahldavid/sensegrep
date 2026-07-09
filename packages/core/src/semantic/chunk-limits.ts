import { Log } from "../util/log.js"
import { getEmbeddingConfig } from "./embedding-config.js"

const log = Log.create({ service: "semantic.chunk-limits" })

const REMOTE_CHUNK_LIMITS = {
  max: 7500,
  min: 200,
  overlap: 3,
  config: {
    simple: 7500,
    medium: 5500,
    complex: 3500,
  },
} as const

export type ChunkLimits = typeof REMOTE_CHUNK_LIMITS

let cachedLimits: ChunkLimits | null = null

function detectChunkLimits(): ChunkLimits {
  try {
    const config = getEmbeddingConfig()
    log.info("treesitter chunk limits provider detected", {
      provider: config.provider,
      max: REMOTE_CHUNK_LIMITS.max,
      envProvider: process.env.SENSEGREP_PROVIDER,
    })
    return REMOTE_CHUNK_LIMITS
  } catch (error) {
    log.warn("treesitter failed to detect provider, using remote chunk limits", { error: String(error) })
    return REMOTE_CHUNK_LIMITS
  }
}

export function getTreeSitterChunkLimits(): ChunkLimits {
  if (!cachedLimits) {
    cachedLimits = detectChunkLimits()
  }
  return cachedLimits
}
