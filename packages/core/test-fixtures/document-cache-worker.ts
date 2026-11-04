import { Instance } from "../src/project/instance.js"
import { DocumentEmbeddingCache } from "../src/semantic/document-embedding-cache.js"
const [root] = process.argv.slice(2)
const identity: DocumentEmbeddingCache.Identity = { revision: "test-v1", accountScope: "account", provider: "mock", model: "mock", endpoint: "local", dimension: 2, taskType: "document", input: "same", transform: "v1" }
await Instance.provide({ directory: root, fn: async () => {
  process.send?.("ready")
  const values = await DocumentEmbeddingCache.getOrCompute([identity], async () => {
    process.send?.("computing")
    await new Promise<void>(resolve => process.once("message", () => resolve()))
    return [[0.6, 0.8]]
  })
  process.send?.({ values })
} })
process.disconnect?.()
