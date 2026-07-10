export const EMBEDDING_PROVIDERS = ["config", "ollama", "gemini", "openai", "bedrock"] as const

export type EmbeddingProviderSetting = (typeof EMBEDDING_PROVIDERS)[number]
export type CredentialProvider = Exclude<EmbeddingProviderSetting, "config" | "ollama">

export function isEmbeddingProvider(value: unknown): value is EmbeddingProviderSetting {
  return typeof value === "string" && EMBEDDING_PROVIDERS.includes(value as EmbeddingProviderSetting)
}

export function isCredentialProvider(value: unknown): value is CredentialProvider {
  return value === "gemini" || value === "openai" || value === "bedrock"
}

export function embeddingSecretKey(provider: CredentialProvider): string {
  return `sensegrep.embeddings.${provider}.apiKey`
}
