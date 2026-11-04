import { describe, expect, it } from "vitest"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createSourceManifest, sourceSnapshotId, validateSourceManifest } from "./source-manifest.js"
import { registerRepository, readRepositoryId } from "../project/repository-identity.js"
import { VectorStore } from "./lancedb.js"
import { Instance } from "../project/instance.js"

const repo = "2f93dd6c-8a70-429d-bc72-4a4e4d615242"
const a = "a".repeat(64)
const b = "b".repeat(64)

describe("indexed source identity", () => {
  it("canonically hashes content and rejects malformed or ambiguous manifests", () => {
    const first = createSourceManifest(repo, { "z.ts": { sourceSha256: b, sourceHashKind: "sha256-raw-v1" }, "a.ts": { sourceSha256: a, sourceHashKind: "sha256-raw-v1" } })!
    const second = createSourceManifest(repo, { "a.ts": { sourceSha256: a, sourceHashKind: "sha256-raw-v1" }, "z.ts": { sourceSha256: b, sourceHashKind: "sha256-raw-v1" } })!
    expect(sourceSnapshotId(first)).toBe(sourceSnapshotId(second))
    expect(first.files.map(file => file.path)).toEqual(["a.ts", "z.ts"])
    expect(sourceSnapshotId(createSourceManifest(repo, { "a.ts": { sourceSha256: b, sourceHashKind: "sha256-raw-v1" } })!)).not.toBe(sourceSnapshotId(first))
    expect(createSourceManifest(repo, { "unknown.ts": {} })).toBeUndefined()
    expect(createSourceManifest(repo, { "../escape": { sourceSha256: a, sourceHashKind: "sha256-raw-v1" } })).toBeUndefined()
    expect(() => validateSourceManifest({ ...first, files: [...first.files].reverse() })).toThrow()
    expect(() => validateSourceManifest({ ...first, extra: true })).toThrow()
  })

  it("requires an explicit immutable checkout binding and updates manifest only for known files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sensegrep-manifest-"))
    try {
      expect(await readRepositoryId(root)).toBeUndefined()
      await Promise.all([registerRepository(root, repo), registerRepository(root, repo)])
      expect(await readRepositoryId(root)).toBe(repo)
      await expect(registerRepository(root, "00000000-0000-4000-8000-000000000000")).rejects.toThrow(/different repository/)
      await Instance.provide({ directory: root, profile: "manifest-test", fn: async () => {
        const meta: VectorStore.IndexMeta = { version: 1, root, tableName: "chunks_test", embeddings: { provider: "test", dimension: 8 }, files: { "a.ts": { size: 1, mtimeMs: 0, sourceSha256: a, sourceHashKind: "sha256-raw-v1" } }, updatedAt: 1 }
        await VectorStore.writeIndexMeta(root, meta)
        const written = await VectorStore.readIndexMeta(root)
        expect(written?.sourceSnapshot?.id).toBe(sourceSnapshotId(written!.sourceSnapshot!.manifest))
        expect(written?.sourceSnapshot?.manifest.repositoryId).toBe(repo)
        expect(written?.indexSpec?.status).toBe("incomplete")
        expect(written?.indexSpecHash).toMatch(/^sha256:[a-f0-9]{64}$/)
        expect(written?.indexSpecHashScope).toBe("recorded-recipe-v1")
        const metaPath = path.join(VectorStore.getIndexStoragePath(root), "index-meta.json")
        const forgedSpec = JSON.parse(await readFile(metaPath, "utf8"))
        forgedSpec.indexSpecHash = `sha256:${a}`
        await writeFile(metaPath, JSON.stringify(forgedSpec))
        expect(await VectorStore.readIndexMeta(root)).toBeNull()
        await mkdir(path.join(root, "child"))
        expect(await VectorStore.resolveIndexedProject(path.join(root, "child"))).toBeNull()
        await VectorStore.writeIndexMeta(root, written!)
        const tampered = JSON.parse(await readFile(metaPath, "utf8"))
        tampered.files["a.ts"].sourceSha256 = b
        await writeFile(metaPath, JSON.stringify(tampered))
        expect(await VectorStore.readIndexMeta(root)).toBeNull()
        await VectorStore.writeIndexMeta(root, { ...written!, tableName: "chunks_legacy", files: { "old.ts": { size: 1, mtimeMs: 0 } } })
        expect((await VectorStore.readIndexMeta(root))?.sourceSnapshot).toBeUndefined()
      } })
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
