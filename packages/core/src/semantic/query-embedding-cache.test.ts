import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { QueryEmbeddingCache } from "./query-embedding-cache.js"

const config = {
  provider: "openai" as const,
  embedModel: "qwen/qwen3-embedding-4b",
  embedDim: 3,
  baseUrl: "https://openrouter.ai/api/v1",
}

describe("QueryEmbeddingCache", () => {
  let directory: string

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "sensegrep-query-cache-"))
    process.env.SENSEGREP_QUERY_CACHE_DIR = directory
    process.env.SENSEGREP_QUERY_CACHE = "true"
  })

  afterEach(async () => {
    delete process.env.SENSEGREP_QUERY_CACHE_DIR
    delete process.env.SENSEGREP_QUERY_CACHE
    await fs.rm(directory, { recursive: true, force: true })
  })

  it("stores vectors by opaque query and embedding identity", async () => {
    const identity = { text: "find authentication checks", taskType: "RETRIEVAL_QUERY", config }
    await QueryEmbeddingCache.set(identity, [0.1, 0.2, 0.3])

    expect(await QueryEmbeddingCache.get(identity)).toEqual([0.1, 0.2, 0.3])
    expect(await QueryEmbeddingCache.get({ ...identity, text: "different query" })).toBeUndefined()
    const [filename] = await fs.readdir(directory)
    expect(filename).not.toContain("authentication")
  })

  it("can be disabled for privacy-sensitive or controlled benchmarks", async () => {
    process.env.SENSEGREP_QUERY_CACHE = "false"
    const identity = { text: "query", taskType: "RETRIEVAL_QUERY", config }
    await QueryEmbeddingCache.set(identity, [0.1, 0.2, 0.3])
    expect(await QueryEmbeddingCache.get(identity)).toBeUndefined()
    expect(await fs.readdir(directory)).toEqual([])
  })
})
