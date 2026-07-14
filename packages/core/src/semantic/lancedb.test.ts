import { describe, expect, it } from "vitest"
import { VectorStore } from "./lancedb.js"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Instance } from "../project/instance.js"

describe("VectorStore distance scoring", () => {
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
