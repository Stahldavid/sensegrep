import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createHash, randomUUID } from "node:crypto"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { expect, it, vi } from "vitest"
import { Instance } from "../project/instance.js"
import { registerRepository } from "../project/repository-identity.js"
import { Embeddings } from "./embeddings.js"
import { Indexer } from "./indexer.js"
import { VectorStore } from "./lancedb.js"
import { readSourceObject } from "./source-object-store.js"
import { cloneDependencyDepth, withCloneGuard } from "./clone-dependencies.js"
import { GenerationLeases } from "./generation-leases.js"

const execute = promisify(execFile)
const config = { provider: "openai" as const, embedModel: "deterministic-worktree-test", embedDim: 8, apiKey: "not-a-provider-key", baseUrl: "http://127.0.0.1:1" }
const vector = (content: string) => {
  const hash = createHash("sha256").update(content).digest()
  const values = Array.from({ length: 8 }, (_, i) => hash[i] / 255 - 0.5)
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0))
  return values.map(value => value / norm)
}

async function dataBytes(directory: string): Promise<number> {
  let total = 0
  for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) total += await dataBytes(filename)
    else if (entry.isFile()) total += (await fs.stat(filename)).size
  }
  return total
}

it("shares a real Git worktree index without embedding or copying base data, then isolates dirty changes, removals and renames", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "sensegrep-worktree-cow-"))
  const a = path.join(temporary, "checkout a"), b = path.join(temporary, "checkout b"), c = path.join(temporary, "checkout c")
  const repository = randomUUID()
  const content = {
    "common.ts": "export function sharedValue() { return 'shared repository value' }\n",
    "dirty.ts": "export function dirtyValue() { return 'original branch value' }\n",
    "removed.ts": "export function removedValue() { return 'visible only in branch a' }\n",
    "rename.ts": "export function renamedValue() { return 'rename keeps content' }\n",
  }
  vi.stubEnv("SENSEGREP_SHARED_OBJECTS", "1")
  vi.stubEnv("SENSEGREP_ANN_MIN_CHUNKS", "0")
  vi.stubEnv("SENSEGREP_COW_MAX_DEPTH", "1")
  const embedded = vi.spyOn(Embeddings, "embed").mockImplementation(async texts => (Array.isArray(texts) ? texts : [texts]).map(vector))
  const run = <T>(root: string, fn: () => Promise<T>) => Instance.provide({ directory: root, profile: "worktree-integration", fn: () => Embeddings.withConfig(config, fn) })
  const git = (args: string[]) => execute("git", ["-C", a, ...args], { env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } })
  try {
    await fs.mkdir(a)
    await git(["init", "--initial-branch=main"])
    for (const [filename, source] of Object.entries(content)) await fs.writeFile(path.join(a, filename), source)
    await git(["add", "."])
    await git(["-c", "user.name=Sensegrep Test", "-c", "user.email=test@example.invalid", "commit", "-m", "fixture"])
    await git(["worktree", "add", "-b", "branch-b", b, "HEAD"])
    await git(["worktree", "add", "-b", "branch-c", c, "HEAD"])
    await fs.utimes(path.join(a, "dirty.ts"), 1_700_000_000, 1_700_000_000)
    await fs.utimes(path.join(b, "dirty.ts"), 1_700_000_000, 1_700_000_000)
    await registerRepository(a, repository); await registerRepository(b, repository)
    const first = await run(a, () => Indexer.indexProject({ timeoutMs: 30_000 }))
    expect(first.files).toBe(4)
    expect(embedded).toHaveBeenCalled()
    const metaA = await run(a, () => VectorStore.readIndexMeta(a))
    const storeA = await run(a, async () => VectorStore.getIndexStoragePath(a))
    const baseDataBytes = await dataBytes(path.join(storeA, `${metaA!.tableName}.lance`, "data"))
    expect(baseDataBytes).toBeGreaterThan(0)

    embedded.mockClear()
    const second = await run(b, () => Indexer.indexProjectIncremental({ timeoutMs: 30_000 }))
    expect(second.mode).toBe("incremental")
    expect(embedded).not.toHaveBeenCalled()
    const metaB = await run(b, () => VectorStore.readIndexMeta(b))
    const storeB = await run(b, async () => VectorStore.getIndexStoragePath(b))
    expect(metaB!.tableName).not.toBe(metaA!.tableName)
    expect(metaB!.sourceSnapshot?.id).toBe(metaA!.sourceSnapshot?.id)
    const cloneDataBytes = await dataBytes(path.join(storeB, `${metaB!.tableName}.lance`, "data"))
    expect(cloneDataBytes).toBeLessThan(baseDataBytes)
    expect(await withCloneGuard(() => cloneDependencyDepth({ directory: storeB, table: metaB!.tableName! }))).toBe(1)
    const hash = metaA!.files["common.ts"].sourceSha256!
    const objectA = await fs.stat(path.join(storeA, ".source-objects", "sha256", hash))
    const objectB = await fs.stat(path.join(storeB, ".source-objects", "sha256", hash))
    expect([objectB.dev, objectB.ino]).toEqual([objectA.dev, objectA.ino])

    await run(a, () => expect(VectorStore.dropCollectionTable(a, metaA!.tableName!)).rejects.toThrow("copy-on-write"))
    await run(a, async () => {
      await VectorStore.createStagingCollection(a, 8)
      const activeForCleanup = await VectorStore.createStagingCollection(a, 8)
      vi.stubEnv("SENSEGREP_INDEX_RETENTION_MS", "60000")
      vi.stubEnv("SENSEGREP_INDEX_RETAIN_GENERATIONS", "1")
      const future = Date.now() + 120_000
      const clock = vi.spyOn(Date, "now").mockReturnValue(future)
      try { await VectorStore.cleanupInactiveTables(a, activeForCleanup.tableName) }
      finally { clock.mockRestore() }
      const release = await new GenerationLeases(storeA, metaA!.tableName!).acquire()
      await release()
      expect((await VectorStore.getCollectionUnsafe(a, 8, metaA!.tableName)).name).toBe(metaA!.tableName)
    })

    // A third real worktree changes bytes while preserving size and timestamp.
    await registerRepository(c, repository)
    await fs.writeFile(path.join(c, "dirty.ts"), content["dirty.ts"].replace("original", "modified"))
    await fs.utimes(path.join(c, "dirty.ts"), 1_700_000_000, 1_700_000_000)
    expect((await fs.stat(path.join(c, "dirty.ts"))).size).toBe(metaB!.files["dirty.ts"].size)
    expect((await fs.stat(path.join(c, "dirty.ts"))).mtimeMs).toBe(metaB!.files["dirty.ts"].mtimeMs)
    await run(c, () => Indexer.indexProjectIncremental({ timeoutMs: 30_000 }))
    expect(embedded).toHaveBeenCalled()
    const dirtyC = await run(c, async () => VectorStore.listDocuments(await VectorStore.getCollectionUnsafe(c, 8)))
    expect(dirtyC.find(row => row.metadata.file === "dirty.ts")!.contentRaw).toContain("modified branch value")
    embedded.mockClear()

    await fs.writeFile(path.join(b, "dirty.ts"), "export function dirtyValue() { return 'private branch b dirty value' }\n")
    await fs.rm(path.join(b, "removed.ts"))
    await fs.rename(path.join(b, "rename.ts"), path.join(b, "renamed.ts"))
    await fs.writeFile(path.join(b, "untracked.ts"), "export const untrackedValue = 'branch b untracked value'\n")
    await run(b, () => Indexer.indexProjectIncremental({ timeoutMs: 30_000 }))
    expect(embedded).toHaveBeenCalled()
    const inspect = (root: string) => run(root, async () => {
      const meta = (await VectorStore.readIndexMeta(root))!
      const table = await VectorStore.getCollectionUnsafe(root, 8, meta.tableName)
      const rows = await VectorStore.listDocuments(table)
      return { meta, table, rows }
    })
    const currentA = await inspect(a), currentB = await inspect(b)
    expect(await withCloneGuard(() => cloneDependencyDepth({ directory: storeB, table: currentB.meta.tableName! }))).toBe(0)
    expect(await dataBytes(path.join(storeB, `${currentB.meta.tableName}.lance`, "data"))).toBeGreaterThan(0)
    expect(new Set(currentA.rows.map(row => row.metadata.file))).toEqual(new Set(Object.keys(content)))
    expect(new Set(currentB.rows.map(row => row.metadata.file))).toEqual(new Set(["common.ts", "dirty.ts", "renamed.ts", "untracked.ts"]))
    expect(currentA.rows.find(row => row.metadata.file === "dirty.ts")!.contentRaw).toContain("original branch value")
    expect(currentB.rows.find(row => row.metadata.file === "dirty.ts")!.contentRaw).toContain("private branch b dirty value")
    expect(currentA.meta.tableName).toBe(metaA!.tableName)
    expect(currentB.meta.sourceSnapshot!.id).not.toBe(currentA.meta.sourceSnapshot!.id)
    expect(await readSourceObject(storeA, metaA!.files["dirty.ts"].sourceSha256!)).toEqual(Buffer.from(content["dirty.ts"]))
    expect(await readSourceObject(storeB, metaB!.files["dirty.ts"].sourceSha256!)).toEqual(Buffer.from(content["dirty.ts"]))
    const common = currentB.rows.find(row => row.metadata.file === "common.ts")!
    const ranked = await run(b, () => VectorStore.searchByVector(currentB.table, common.vector!, { limit: 20 }))
    expect(ranked[0].metadata.file).toBe("common.ts")
    expect(ranked.some(row => row.metadata.file === "removed.ts" || row.metadata.file === "rename.ts")).toBe(false)
    expect(await dataBytes(path.join(storeA, `${metaA!.tableName}.lance`, "data"))).toBe(baseDataBytes)

    const releaseA = await run(a, () => VectorStore.releaseIndexView(a))
    expect(releaseA.retainedTables).toBeGreaterThan(0)
    expect(await run(a, () => VectorStore.readIndexMeta(a))).toBeNull()
    await expect(run(a, () => Indexer.indexProjectIncremental({ respectReleasedView: true }))).rejects.toThrow("view was released")
    expect((await inspect(b)).rows.some(row => row.metadata.file === "untracked.ts")).toBe(true)
    const reader = await new GenerationLeases(storeB, currentB.meta.tableName!).acquire()
    await fs.rm(b, { recursive: true, force: true })
    const releaseB = await run(b, () => VectorStore.releaseIndexView(b))
    expect(releaseB.retainedTables).toBeGreaterThan(0)
    await run(c, () => VectorStore.collectReleasedViews(c))
    expect(await dataBytes(path.join(storeB, `${currentB.meta.tableName}.lance`))).toBeGreaterThan(0)
    await reader()
    const collected = await run(c, () => VectorStore.collectReleasedViews(c))
    expect(collected.retainedTables).toBe(0)
    expect(await dataBytes(path.join(storeA, `${metaA!.tableName}.lance`))).toBe(0)
    expect((await inspect(c)).rows.find(row => row.metadata.file === "dirty.ts")!.contentRaw).toContain("modified branch value")
  } finally {
    embedded.mockRestore(); vi.unstubAllEnvs()
    await fs.rm(temporary, { recursive: true, force: true })
  }
}, 60_000)
