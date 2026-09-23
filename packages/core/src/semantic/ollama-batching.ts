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

/** Count HTTP batches inside each index batch, excluding retries. */
export function estimateOllamaRequests(chunks: number, indexBatchSize: number): number {
  const httpBatchSize = getOllamaBatchSize()
  return Math.floor(chunks / indexBatchSize) * Math.ceil(indexBatchSize / httpBatchSize)
    + Math.ceil((chunks % indexBatchSize) / httpBatchSize)
}
