import { describe, expect, it } from "vitest"
import { embeddingSecretKey, isCredentialProvider, isEmbeddingProvider } from "./embedding-settings"

describe("VS Code embedding settings", () => {
  it("keeps the provider list and credential providers consistent", () => {
    expect(isEmbeddingProvider("ollama")).toBe(true)
    expect(isEmbeddingProvider("config")).toBe(true)
    expect(isEmbeddingProvider("fastembed")).toBe(false)
    expect(isCredentialProvider("openai")).toBe(true)
    expect(isCredentialProvider("ollama")).toBe(false)
  })

  it("uses provider-scoped secret keys", () => {
    expect(embeddingSecretKey("bedrock")).toBe("sensegrep.embeddings.bedrock.apiKey")
  })
})
