import { describe, expect, it } from "vitest"
import { observeIndexSpec, recordedRecipeHash } from "./index-spec.js"

describe("index specification observations", () => {
  it("records available effective settings without asserting full identity", () => {
    const meta = { embeddings: { provider: "openai", model: "model", dimension: 3 }, chunking: { version: 6, tokenizer: "estimate:utf8-div3:v1", maxChars: 128 } }
    const result = observeIndexSpec(meta)
    expect(result).toMatchObject({ status: "incomplete", embedding: { provider: "openai", model: "model", dimension: 3 }, chunking: meta.chunking })
    expect(result.missing).toContain("parser-and-fallback")
    expect(result.missing).toContain("embedding-model-revision")
    expect(result.missing).toContain("embedding-transformation")
    expect(result).not.toHaveProperty("hash")
    expect(recordedRecipeHash(result)).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(recordedRecipeHash(observeIndexSpec({ ...meta, chunking: { maxChars: 128, tokenizer: "estimate:utf8-div3:v1", version: 6 } }))).toBe(recordedRecipeHash(result))
    expect(recordedRecipeHash(observeIndexSpec({ ...meta, embeddings: { ...meta.embeddings, configFingerprint: "different endpoint" } }))).not.toBe(recordedRecipeHash(result))
    expect(observeIndexSpec({ ...meta, chunking: { ...meta.chunking, maxChars: 256 } })).not.toEqual(result)
    expect(observeIndexSpec({ ...meta, chunking: { ...meta.chunking, tokenizer: "huggingface:other" } })).not.toEqual(result)
    expect(observeIndexSpec({ ...meta, embeddings: { ...meta.embeddings, dimension: 4 } })).not.toEqual(result)
  })
  it("preserves unknown information in legacy data", () => {
    expect(observeIndexSpec({ embeddings: { provider: "test", dimension: 2 } }).missing).toEqual(expect.arrayContaining(["chunking", "tokenizer", "embedding-model"]))
  })
})
