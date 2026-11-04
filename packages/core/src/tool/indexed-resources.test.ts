import { describe, expect, it, vi } from "vitest"
import { Instance } from "../project/instance.js"

const state = vi.hoisted(() => ({ fingerprint: "wrong-index-configuration" as string | undefined }))
const release = vi.hoisted(() => vi.fn(async () => {}))
const acquire = vi.hoisted(() => vi.fn(async (_signal?: AbortSignal) => release))
const verifyIndex = vi.hoisted(() => vi.fn(async () => ({ indexed: true, isStale: false, changed: 0, missing: 0, removed: 0 })))
vi.mock("../semantic/generation-leases.js", () => ({ GenerationLeases: class { acquire = acquire } }))
vi.mock("../semantic/indexer.js", () => ({ Indexer: { verifyIndex } }))
vi.mock("../semantic/embeddings.js", () => ({ Embeddings: {
  withConfig: (_config: unknown, fn: () => unknown) => fn(),
  getConfig: () => ({ provider: "openai", embedModel: "model", embedDim: 3, baseUrl: "http://127.0.0.1:1234" }),
} }))
vi.mock("../semantic/lancedb.js", () => ({ VectorStore: {
  resolveIndexedProject: async () => ({ root: "/repo", requestedPath: "/repo/child", meta: { tableName: "captured", updatedAt: 1, embeddings: { provider: "openai", model: "model", dimension: 3, get configFingerprint() { return state.fingerprint } } } }),
  getIndexStoragePath: () => "/mock-index",
  inspectCollectionSchema: async () => ({ exists: true, schemaCompatible: true, fields: [], missingFields: [], tableName: "captured" }),
  getCollectionUnsafe: async () => ({}),
} }))
import { withIndexedSearchResources } from "./sensegrep-pipeline.js"

describe("indexed resource context", () => {
  it("rejects grouped embedding configuration mismatch and releases the generation", async () => {
    state.fingerprint = "wrong-index-configuration"
    release.mockClear(); verifyIndex.mockClear()
    const callback = vi.fn(async () => ({ output: "unexpected" }))
    const result = await Instance.provide({ directory: "/repo/child", profile: "alpha", fn: () => withIndexedSearchResources("query", callback) })
    expect(result).toMatchObject({ status: "incompatible-embedding-config" })
    expect(callback).not.toHaveBeenCalled()
    expect(verifyIndex).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalledOnce()
  })

  it("passes the request signal through lease acquisition and freshness verification", async () => {
    state.fingerprint = undefined
    const controller = new AbortController()
    const callback = vi.fn(async () => ({ output: "ok" }))
    await Instance.provide({ directory: "/repo/child", profile: "alpha", fn: () => withIndexedSearchResources("query", callback, controller.signal) })
    expect(acquire).toHaveBeenLastCalledWith(controller.signal)
    expect(verifyIndex).toHaveBeenLastCalledWith(expect.objectContaining({ signal: expect.any(AbortSignal), resolved: expect.objectContaining({ root: "/repo" }) }))
    expect(callback).toHaveBeenCalledOnce()
  })
})
