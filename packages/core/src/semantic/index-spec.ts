import { createHash } from "node:crypto"

/** Recorded recipe identity is separate from reproducibility of its outputs. */
export type IndexSpecObservation = {
  version: 1
  status: "incomplete"
  embedding: { provider: string; model: string | null; dimension: number; configurationHash?: string }
  chunking: Record<string, number | string> | null
  missing: string[]
}

const CHUNKING_FIELDS = ["version", "provider", "model", "dimension", "maxInputTokens", "modelMaxTokens", "usableModelTokens", "maxChars", "minChars", "overlapChars", "simpleChars", "mediumChars", "complexChars", "targetTokens", "preserveTokens", "contextTokens", "tokenizer"] as const

export function observeIndexSpec(meta: { embeddings: { provider: string; model?: string; dimension: number; configFingerprint?: string }; chunking?: object }): IndexSpecObservation {
  const source = meta.chunking as Record<string, unknown> | undefined
  const chunking: Record<string, number | string> = {}
  if (source) for (const key of CHUNKING_FIELDS) {
    const value = source[key]
    if (typeof value === "string" || typeof value === "number" && Number.isFinite(value)) chunking[key] = value
  }
  // Parser/fallback and model revisions are not captured by current runtimes;
  // transformer/normalization code identity is also not recorded. Never hash
  // this partial observation as a complete index specification.
  const missing = ["parser-and-fallback", "embedding-model-revision", "embedding-transformation"]
  if (!source) missing.push("chunking")
  if (typeof chunking.tokenizer !== "string") missing.push("tokenizer")
  if (!meta.embeddings.model) missing.push("embedding-model")
  return { version: 1, status: "incomplete", embedding: { provider: meta.embeddings.provider, model: meta.embeddings.model ?? null, dimension: meta.embeddings.dimension,
    ...(meta.embeddings.configFingerprint ? { configurationHash: createHash("sha256").update(meta.embeddings.configFingerprint).digest("hex") } : {}) }, chunking: source ? chunking : null, missing }
}

/** Hash the recorded recipe including unknown fields. Equality never proves equal vectors. */
export function recordedRecipeHash(spec: IndexSpecObservation): string {
  const canonical = { version: spec.version, status: spec.status,
    embedding: { provider: spec.embedding.provider, model: spec.embedding.model, dimension: spec.embedding.dimension,
      ...(spec.embedding.configurationHash ? { configurationHash: spec.embedding.configurationHash } : {}) },
    chunking: spec.chunking ? Object.fromEntries(Object.entries(spec.chunking).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : null,
    missing: [...spec.missing].sort(),
  }
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical)).digest("hex")}`
}
