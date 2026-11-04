import { build } from "esbuild"
import { randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import { GenerationLeases } from "./generation-leases.js"
import { describe, expect, it, vi } from "vitest"
import { VectorStore } from "./lancedb.js"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Instance } from "../project/instance.js"
import { getChunkingSignature } from "./chunk-limits.js"

describe("VectorStore distance scoring", () => {
  it("round-trips chunk policy and tokenizer identity through index metadata", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "sensegrep-policy-meta-"))
    await Instance.provide({ directory: root, profile: "default", fn: async () => {
      try {
        const chunking = getChunkingSignature({ provider: "ollama", embedModel: "qwen3-embedding:0.6b", embedDim: 1024, contextTokens: 8192, chunking: { targetTokens: 1024 } })
        await VectorStore.writeIndexMeta(root, {
          version: 1, root, chunking,
          embeddings: { provider: "ollama", model: "qwen3-embedding:0.6b", dimension: 1024 },
          files: {}, updatedAt: Date.now(),
        })
        expect((await VectorStore.readIndexMeta(root))?.chunking).toEqual(chunking)
      } finally {
        await VectorStore.deleteCollection(root).catch(() => {})
        await fs.rm(root, { recursive: true, force: true })
      }
    } })
  })
  it("converts l2 distance between normalized vectors back to cosine similarity", () => {
    const cosineSimilarity = 0.3
    const l2Distance = Math.sqrt(2 - 2 * cosineSimilarity)

    expect(VectorStore.distanceToSimilarity(l2Distance, "l2")).toBeCloseTo(cosineSimilarity, 6)
  })

  it("uses cosine distance as the default score conversion", () => {
    expect(VectorStore.distanceToSimilarity(0.28)).toBeCloseTo(0.72, 6)
    expect(VectorStore.DEFAULT_DISTANCE_METRIC).toBe("cosine")
  })

  it("skips unsupported exact subdirectory metadata and reuses a compatible parent index", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "sensegrep-resolve-"))
    const subdir = path.join(root, "apps", "web")
    await fs.mkdir(subdir, { recursive: true })

    await Instance.provide({
      directory: root,
      profile: "default",
      fn: async () => {
        try {
          await VectorStore.writeIndexMeta(root, {
        version: 1,
        root,
        embeddings: { provider: "openai", model: "ok", dimension: 3, distanceMetric: "cosine" },
        files: {
          "apps/web/a.ts": { size: 1, mtimeMs: 1, hash: "h", chunks: ["c"] },
        },
        updatedAt: 2,
      })
          await VectorStore.writeIndexMeta(subdir, {
        version: 1,
        root: subdir,
        embeddings: { provider: "local" as any, model: "old", dimension: 384 },
        files: {
          "a.ts": { size: 1, mtimeMs: 1, hash: "h", chunks: ["c"] },
        },
        updatedAt: 3,
      })

          const resolved = await VectorStore.resolveIndexedProject(subdir)
          const canonicalRoot = await fs.realpath(root)

          expect(resolved?.root).toBe(canonicalRoot)
          expect(resolved?.subdirPrefix).toBe("apps/web")
          expect(resolved?.meta.embeddings.provider).toBe("openai")
        } finally {
          await VectorStore.deleteCollection(root).catch(() => {})
          await VectorStore.deleteCollection(subdir).catch(() => {})
          await fs.rm(root, { recursive: true, force: true })
        }
      },
    })
  })

  it("keeps an inactive table while leased and collects it after release", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "sensegrep-retain-"))
    try {
      await Instance.provide({ directory: root, profile: "default", fn: async () => {
        const now = Date.now()
        const clock = vi.spyOn(Date, "now")
        let old: Awaited<ReturnType<typeof VectorStore.createStagingCollection>>
        try {
          clock.mockReturnValue(now - 200_000_000)
          old = await VectorStore.createStagingCollection(root, 3)
          clock.mockReturnValue(now - 190_000_000)
          await VectorStore.createStagingCollection(root, 3)
          clock.mockReturnValue(now - 180_000_000)
          await VectorStore.createStagingCollection(root, 3)
        } finally { clock.mockRestore() }
        const leases = new GenerationLeases(VectorStore.getIndexStoragePath(root), old.tableName)
        const bundle = path.resolve("node_modules/.cache", `generation-db-${randomUUID()}.mjs`)
        await fs.mkdir(path.dirname(bundle), { recursive: true })
        await build({ entryPoints: [path.resolve("packages/core/test-fixtures/generation-lease-worker.ts")], outfile: bundle,
          bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent" })
        const child = spawn(process.execPath, [bundle, VectorStore.getIndexStoragePath(root), old.tableName],
          { stdio: ["ignore", "ignore", "pipe", "ipc"] })
        try {
          await new Promise<void>((resolve, reject) => { child.once("message", () => resolve()); child.once("error", reject); child.once("exit", code => reject(new Error(`reader exited: ${code}`))) })
          await VectorStore.cleanupInactiveTables(root, "active-placeholder")
          expect((await VectorStore.inspectCollectionSchema(root, old.tableName)).exists).toBe(true)
          const released = new Promise<void>(resolve => child.once("message", () => resolve()))
          child.send!("release")
          await released
        } finally {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
          await fs.rm(bundle, { force: true })
        }
        await VectorStore.cleanupInactiveTables(root, "active-placeholder")
        expect((await VectorStore.inspectCollectionSchema(root, old.tableName)).exists).toBe(false)
        await expect(leases.acquire()).rejects.toThrow("being collected")
      } })
    } finally {
      await VectorStore.deleteCollection(root).catch(() => {})
      await fs.rm(root, { recursive: true, force: true })
    }
  })
  it("inspects a missing collection without creating a table", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "sensegrep-readonly-"))
    try {
      expect(await VectorStore.hasCollection(root)).toBe(false)
      const inspection = await VectorStore.inspectCollectionSchema(root)
      expect(inspection).toMatchObject({ exists: false, schemaCompatible: false, migrationRequired: false })
      expect(await VectorStore.hasCollection(root)).toBe(false)
    } finally {
      await VectorStore.deleteCollection(root).catch(() => {})
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("uses a typed non-destructive schema mismatch error", () => {
    const error = new VectorStore.IndexSchemaMismatchError("/repo", "chunks_old", ["calls", "fileRole"])
    expect(error).toMatchObject({ code: "INDEX_SCHEMA_MISMATCH", tableName: "chunks_old", missingFields: ["calls", "fileRole"] })
    expect(error.message).toContain("index --full --no-watch")
  })
})
