import type { EmbeddingConfig } from "./embedding-config.js"

const capacities = new Map<string, Promise<number>>()

/** Confirm the actual installed model's capability, not just a name-based guess. */
export async function resolveOllamaContext(config: EmbeddingConfig, signal?: AbortSignal): Promise<number> {
  const baseUrl = (config.baseUrl || "http://127.0.0.1:11434").replace(/\/+$/, "")
  const key = `${baseUrl}\0${config.embedModel}`
  let pending = capacities.get(key)
  if (!pending) {
    pending = (async () => {
      const response = await fetch(`${baseUrl}/api/show`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: config.embedModel }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
      })
      if (!response.ok) throw new Error(`Cannot inspect Ollama model ${config.embedModel} (${response.status}). Check that the model is installed.`)
      const data = await response.json() as { model_info?: Record<string, unknown> }
      const capacity = Object.entries(data.model_info ?? {}).find(([key]) => key.endsWith(".context_length"))?.[1]
      if (typeof capacity !== "number" || !Number.isSafeInteger(capacity) || capacity < 64) {
        throw new Error("Ollama /api/show did not report a valid model context_length")
      }
      return capacity
    })()
    capacities.set(key, pending)
    pending.catch(() => capacities.delete(key))
  }
  const capacity = await pending
  return Math.min(capacity, config.maxInputTokens ?? capacity, config.contextTokens ?? 8192)
}
