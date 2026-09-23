import { getEmbeddingConfig, type EmbeddingConfig } from "./embedding-config.js"
import { countEmbeddingTokens } from "./token-count.js"

/** Shared by the HTTP provider and index planning; changing this must not change index batches. */
export function getOllamaBatchSize(): number {
  const configured = process.env.SENSEGREP_OLLAMA_BATCH_SIZE || process.env.SENSEGREP_EMBED_BATCH_SIZE
  if (configured) {
    const parsed = Number(configured)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`SENSEGREP_OLLAMA_BATCH_SIZE/SENSEGREP_EMBED_BATCH_SIZE must be a positive number, got "${configured}".`)
    }
    return Math.max(1, Math.floor(parsed))
  }
  return 16
}

/** Bound both document count and aggregate tokens, preserving input/output order. */
export function packOllamaBatches(texts: string[], config: EmbeddingConfig = getEmbeddingConfig()): string[][] {
  const maxCount = getOllamaBatchSize()
  const maxTokens = config.batchTokens ?? 16_384
  const batches: string[][] = []
  let batch: string[] = []
  let tokens = 0
  for (const text of texts) {
    const size = countEmbeddingTokens(text, config)
    if (batch.length && (batch.length >= maxCount || tokens + size > maxTokens)) {
      batches.push(batch)
      batch = []
      tokens = 0
    }
    // A valid document larger than the aggregate target is sent alone.
    batch.push(text)
    tokens += size
  }
  if (batch.length) batches.push(batch)
  return batches
}

/** Count HTTP batches inside each index batch, excluding retries. */
export function estimateOllamaRequests(chunks: number, indexBatchSize: number): number {
  const httpBatchSize = getOllamaBatchSize()
  return Math.floor(chunks / indexBatchSize) * Math.ceil(indexBatchSize / httpBatchSize)
    + Math.ceil((chunks % indexBatchSize) / httpBatchSize)
}
