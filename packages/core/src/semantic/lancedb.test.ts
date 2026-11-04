import { build } from "esbuild"
import { createHash, randomUUID } from "node:crypto"
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
  it("does not adopt a weak legacy directory name without a matching checkout binding", async () => {
    const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "sensegrep-unbound-legacy-")))
    const root = path.join(temporary, "requested"), other = path.join(temporary, "unrelated")
    await Promise.all([fs.mkdir(root), fs.mkdir(other)])
    let legacy = ""
    try {
      await Instance.provide({ directory: root, profile: "default", fn: async () => {
        const canonicalStore = VectorStore.getIndexStoragePath(root)
        let hash = 0
        for (const character of root) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0
        legacy = path.join(path.dirname(canonicalStore), `project_${Math.abs(hash).toString(16)}`)
        await fs.mkdir(legacy, { recursive: true })
        const metadata = JSON.stringify({ version: 1, root: other, embeddings: { provider: "openai", model: "test", dimension: 3 }, files: {}, updatedAt: 1 })
        await fs.writeFile(path.join(legacy, "index-meta.json"), metadata)
        expect(VectorStore.getIndexStoragePath(root)).toBe(canonicalStore)
        expect(await VectorStore.readIndexMeta(root)).toBeNull()
        expect(await fs.readFile(path.join(legacy, "index-meta.json"), "utf8")).toBe(metadata)
      } })
    } finally {
      if (legacy) await fs.rm(legacy, { recursive: true, force: true })
      await fs.rm(temporary, { recursive: true, force: true })
    }
  })
  it("finds and releases a removed checkout through an ancestor alias", async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "sensegrep-removed-alias-"))
    const realParent = path.join(temporary, "real"), aliasParent = path.join(temporary, "alias")
    const root = path.join(realParent, "checkout"), alias = path.join(aliasParent, "checkout")
    await fs.mkdir(root, { recursive: true })
    await fs.symlink(realParent, aliasParent, process.platform === "win32" ? "junction" : "dir")
    const profile = "removed-alias-test"
    let legacyStore = ""
    try {
      await Instance.provide({ directory: root, profile, fn: async () => {
        const canonicalStore = VectorStore.getIndexStoragePath(root)
        await VectorStore.writeIndexMeta(root, { version: 1, root: alias, profile, embeddings: { provider: "openai", model: "test", dimension: 3 }, files: {}, updatedAt: 1 })
        legacyStore = `${canonicalStore}-legacy`
        await fs.rename(canonicalStore, legacyStore)
        await fs.rm(root, { recursive: true })
        expect(VectorStore.getIndexStoragePath(alias)).toBe(legacyStore)
        expect((await VectorStore.readIndexMeta(alias))?.root).toBe(alias)
        await VectorStore.releaseIndexView(alias)
        expect(VectorStore.getIndexStoragePath(alias)).toBe(legacyStore)
        expect(await fs.stat(path.join(legacyStore, ".released-view.json"))).toBeDefined()
      } })
    } finally {
      if (legacyStore) await fs.rm(legacyStore, { recursive: true, force: true })
      await fs.rm(temporary, { recursive: true, force: true })
    }
  })
  it("discovers a legacy alias store and refuses ambiguous stores without moving them", async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "sensegrep-legacy-alias-"))
    const root = path.join(temporary, "root"), alias = path.join(temporary, "alias")
    await fs.mkdir(root)
    await fs.symlink(root, alias, process.platform === "win32" ? "junction" : "dir")
    await Instance.provide({ directory: root, profile: "legacy-alias-test", fn: async () => {
      const canonicalStore = VectorStore.getIndexStoragePath(root)
      const normalizedAlias = process.platform === "win32" ? path.resolve(alias).toLowerCase() : path.resolve(alias)
      const hash = createHash("sha256").update(normalizedAlias).digest("hex").slice(0, 24)
      const suffix = createHash("sha256").update("legacy-alias-test").digest("hex").slice(0, 12)
      const legacyStore = path.join(path.dirname(canonicalStore), `project_${hash}_${suffix}`)
      const duplicate = `${legacyStore}-duplicate`
      try {
        await VectorStore.writeIndexMeta(root, { version: 1, root, profile: "legacy-alias-test", embeddings: { provider: "openai", model: "test", dimension: 3 }, files: {}, updatedAt: 1 })
        await fs.rename(canonicalStore, legacyStore)
        await fs.mkdir(canonicalStore)
        await fs.writeFile(path.join(canonicalStore, "staging-only"), "preserve")
        expect(VectorStore.getIndexStoragePath(root)).toBe(legacyStore)
        expect((await VectorStore.readIndexMeta(alias))?.root).toBe(root)
        await fs.cp(legacyStore, duplicate, { recursive: true })
        expect(() => VectorStore.getIndexStoragePath(root)).toThrow(/Ambiguous index storage/)
        expect(await fs.stat(legacyStore)).toBeDefined()
        expect(await fs.stat(duplicate)).toBeDefined()
        expect(await fs.readFile(path.join(canonicalStore, "staging-only"), "utf8")).toBe("preserve")
      } finally {
        await fs.rm(legacyStore, { recursive: true, force: true })
        await fs.rm(duplicate, { recursive: true, force: true })
        await fs.rm(canonicalStore, { recursive: true, force: true })
      }
    } })
    await fs.rm(temporary, { recursive: true, force: true })
  })
  it("uses one index binding for canonical and symlinked checkout paths", async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "sensegrep-alias-"))
    const root = path.join(temporary, "root"), alias = path.join(temporary, "alias")
    await fs.mkdir(path.join(root, "child"), { recursive: true })
    await fs.symlink(root, alias, process.platform === "win32" ? "junction" : "dir")
    try {
      await Instance.provide({ directory: alias, profile: "alias-test", fn: async () => {
        await VectorStore.writeIndexMeta(root, {
          version: 1, root, profile: "alias-test", embeddings: { provider: "openai", model: "test", dimension: 3 }, files: {}, updatedAt: 1,
        })
        expect(VectorStore.getIndexStoragePath(alias)).toBe(VectorStore.getIndexStoragePath(root))
        expect((await VectorStore.readIndexMeta(alias))?.root).toBe(root)
        expect((await VectorStore.resolveIndexedProject(path.join(alias, "child")))?.root).toBe(await fs.realpath(root))
        await VectorStore.deleteCollection(root)
      } })
    } finally { await fs.rm(temporary, { recursive: true, force: true }) }
  })
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
