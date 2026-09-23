import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { withEmbeddingConfig, getEmbeddingConfig } from "./embedding-config.js"
import { getChunkingSignature, getOperationalContextTokens, getTreeSitterChunkLimits } from "./chunk-limits.js"
import { countEmbeddingTokens, tokenCounterIdentity } from "./token-count.js"
import { packOllamaBatches } from "./ollama-batching.js"
import { Chunking } from "./chunking.js"

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sensegrep-token-policy-"))
const tokenizerPath = path.join(directory, "tokenizer.json")
fs.writeFileSync(tokenizerPath, JSON.stringify({
  version: "1.0", added_tokens: [], normalizer: null,
  pre_tokenizer: { type: "Whitespace" },
  model: { type: "WordLevel", vocab: { "[UNK]": 0, hello: 1, world: 2 }, unk_token: "[UNK]" },
  post_processor: null, decoder: null,
}))
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }))
const config = { provider: "ollama" as const, embedModel: "qwen3-embedding:0.6b", embedDim: 1024 }

describe("configurable token policy", () => {
  it("counts using a local tokenizer and invalidates the signature when vocabulary changes", () => {
    const configured = { ...config, tokenizerPath }
    expect(countEmbeddingTokens("hello world", configured)).toBe(2)
    const before = tokenCounterIdentity(configured)
    const raw = JSON.parse(fs.readFileSync(tokenizerPath, "utf8"))
    raw.model.vocab.extra = 3
    fs.writeFileSync(tokenizerPath, JSON.stringify(raw))
    expect(tokenCounterIdentity(configured)).not.toBe(before)
    expect(getChunkingSignature(configured).tokenizer).toMatch(/^huggingface:/)
  })

  it("caps policy by runtime and model, without assuming all Ollama models have 32K", async () => {
    expect(getOperationalContextTokens({ ...config, embedModel: "unknown" })).toBe(2048)
    await withEmbeddingConfig({ ...config, contextTokens: 8192, chunking: { targetTokens: 1024, preserveTokens: 3000, maxTokens: 6000 } }, async () => {
      const limits = getTreeSitterChunkLimits()
      expect(limits.tokens.max).toBe(6000)
      expect(limits.targetTokens).toBe(1024)
      expect(limits.tokenConfig).toEqual({ simple: 3000, medium: 3000, complex: 3000 })
    })
    expect(getChunkingSignature({ ...config, chunking: { targetTokens: 1024 } })).not.toEqual(getChunkingSignature(config))
  })

  it("rejects invalid explicit policy instead of silently using defaults", async () => {
    await expect(withEmbeddingConfig({ ...config, chunking: { maxTokens: -1 } }, async () => getEmbeddingConfig())).rejects.toThrow("positive integer")
    expect(() => tokenCounterIdentity({ ...config, tokenizerPath: path.join(directory, "missing") })).toThrow()
  })

  it("splits complete input after metadata/overlap without losing Unicode or the final rule", async () => {
    await withEmbeddingConfig({ ...config, tokenizerPath, chunking: { maxTokens: 64 } }, async () => {
      const content = "// metadata\n" + "hello world 🩺\n".repeat(100) + "FINAL_RULE"
      const chunks = Chunking.enforceEmbeddingBudget([{ content, startLine: 7, endLine: 107, symbolName: "guard", type: "code" }])
      expect(chunks.length).toBeGreaterThan(1)
      expect(chunks.map((chunk) => chunk.content).join("")).toBe(content)
      expect(chunks.every((chunk) => countEmbeddingTokens(chunk.content) <= 64 && chunk.symbolName === "guard")).toBe(true)
    })
  })

  it("limits batch tokens while keeping all documents in order", () => {
    const input = ["hello world", "hello world hello", "world", "hello ".repeat(10)]
    const batches = packOllamaBatches(input, { ...config, tokenizerPath, batchTokens: 4 })
    expect(batches).toEqual([[input[0]], [input[1], input[2]], [input[3]]])
    expect(batches.flat()).toEqual(input)
  })
})
