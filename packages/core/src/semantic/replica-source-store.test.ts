import { describe, expect, it } from "vitest"
import { createHash } from "node:crypto"
import { spawn } from "node:child_process"
import { build } from "esbuild"
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { createSourceManifest, sourceSnapshotId } from "./source-manifest.js"
import { collectReplicaObjects, getReplicaObject, pinReplicaSnapshot, putReplicaObject, readReplicaBundle, removeReplicaSnapshot, storeReplicaBundle, unpinReplicaSnapshot, type ReplicaBundle } from "./replica-source-store.js"

const repo = "00000000-0000-4000-8000-000000000001"
const hash = (s: string) => createHash("sha256").update(s).digest("hex")
function bundle(files: Record<string, string>, repositoryId = repo): ReplicaBundle {
  const manifest = createSourceManifest(repositoryId, Object.fromEntries(Object.entries(files).map(([file, content]) => [file, { sourceSha256: hash(content), sourceHashKind: "sha256-raw-v1" }])))!
  return { version: 1, manifest, snapshotId: sourceSnapshotId(manifest), files: manifest.files.map(({ path: file }) => ({ path: file, contentBase64: Buffer.from(files[file]).toString("base64") })) }
}
async function fixture(fn: (dir: string) => Promise<void>) { const dir = await mkdtemp(path.join(os.tmpdir(), "sensegrep-replica-")); try { await fn(dir) } finally { await rm(dir, { recursive: true, force: true }) } }

describe("deduplicated replica source storage", () => {
  it("stores small manifests and one copy of shared bytes across independent snapshots", async () => fixture(async directory => {
    const first = bundle({ "same.ts": "shared", "edit.ts": "first" }), second = bundle({ "same.ts": "shared", "edit.ts": "second" })
    const a = await storeReplicaBundle(directory, first), b = await storeReplicaBundle(directory, second)
    expect((await readdir(path.join(directory, ".replica-objects", "sha256"))).length).toBe(3)
    const artifact = JSON.parse(await readFile(a, "utf8"))
    expect(artifact).toMatchObject({ storage: "source-replica-v1", snapshotId: first.snapshotId })
    expect(artifact).not.toHaveProperty("files")
    expect(await readReplicaBundle(a, { repositoryId: repo, snapshotId: first.snapshotId })).toEqual(first)
    expect(await readReplicaBundle(b, { repositoryId: repo, snapshotId: second.snapshotId })).toEqual(second)
    await expect(storeReplicaBundle(directory, bundle({ "a": "other" }, "00000000-0000-4000-8000-000000000002"))).rejects.toThrow("incompatible")
  }))
  it("retains pinned snapshots while evicting old manifests and refuses to evict referenced bytes for capacity", async () => fixture(async directory => {
    const first = bundle({ "a": "first" }), second = bundle({ "a": "second" }), third = bundle({ "a": "third" })
    const a = await storeReplicaBundle(directory, first, { retainSnapshots: 1 })
    await pinReplicaSnapshot(directory, first.snapshotId)
    const b = await storeReplicaBundle(directory, second, { retainSnapshots: 1 })
    await new Promise(resolve => setTimeout(resolve, 5))
    await storeReplicaBundle(directory, third, { retainSnapshots: 1 })
    await expect(readFile(b)).rejects.toMatchObject({ code: "ENOENT" })
    expect(await readReplicaBundle(a, { repositoryId: repo, snapshotId: first.snapshotId })).toEqual(first)
    await expect(removeReplicaSnapshot(directory, first.snapshotId)).rejects.toThrow("pinned")
    await expect(collectReplicaObjects(directory, { maxBytes: 1 })).rejects.toThrow("budget exceeded")
    await unpinReplicaSnapshot(directory, first.snapshotId)
    await removeReplicaSnapshot(directory, first.snapshotId)
    await collectReplicaObjects(directory, { retainSnapshots: 1, maxBytes: 5 })
    expect((await readdir(path.join(directory, ".replica-objects", "sha256"))).length).toBe(1)
  }))
  it("supports resumable object imports, verifies cache hits and bounds unreferenced objects", async () => fixture(async directory => {
    expect(await getReplicaObject(directory, hash("first"), repo)).toBeUndefined()
    await putReplicaObject(directory, repo, hash("first"), Buffer.from("first"), { maxBytes: 6 })
    expect(await getReplicaObject(directory, hash("first"), repo)).toEqual(Buffer.from("first"))
    await putReplicaObject(directory, repo, hash("second"), Buffer.from("second"), { maxBytes: 6 })
    expect(await getReplicaObject(directory, hash("first"), repo)).toBeUndefined()
    await writeFile(path.join(directory, ".replica-objects", "sha256", hash("second")), "broken")
    await expect(getReplicaObject(directory, hash("second"), repo)).rejects.toThrow("content mismatch")
    await expect(putReplicaObject(directory, repo, hash("third"), Buffer.from("wrong"))).rejects.toThrow("content mismatch")
  }))
  it("serializes imports and collection from separate processes", async () => fixture(async directory => {
    const worker = path.join(directory, "worker.mjs")
    const store = path.join(directory, "store")
    await build({ stdin: { contents: `import { storeReplicaBundle, collectReplicaObjects } from ${JSON.stringify(path.resolve("packages/core/src/semantic/replica-source-store.ts"))}; const input = JSON.parse(process.argv[3]); const artifact = await storeReplicaBundle(process.argv[2], input); await collectReplicaObjects(process.argv[2]); process.stdout.write(artifact);`, resolveDir: process.cwd(), loader: "ts" }, outfile: worker, bundle: true, platform: "node", format: "esm", logLevel: "silent" })
    const inputs = [bundle({ "same": "shared", "private": "left" }), bundle({ "same": "shared", "private": "right" })]
    const artifacts = await Promise.all(inputs.map(input => new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, [worker, store, JSON.stringify(input)], { stdio: ["ignore", "pipe", "pipe"] })
      let output = "", error = ""
      child.stdout.on("data", data => { output += data }); child.stderr.on("data", data => { error += data })
      child.once("error", reject); child.once("exit", code => code === 0 ? resolve(output) : reject(new Error(`Replica process failed ${code}: ${error}`)))
    })))
    expect((await readdir(path.join(store, ".replica-objects", "sha256"))).length).toBe(3)
    for (let i = 0; i < inputs.length; i++) expect(await readReplicaBundle(artifacts[i], { repositoryId: repo, snapshotId: inputs[i].snapshotId })).toEqual(inputs[i])
  }))

  it("cancels cache lookup while the destination guard is occupied", async () => fixture(async directory => {
    await putReplicaObject(directory, repo, hash("first"), Buffer.from("first"))
    const guard = path.join(directory, ".retention-guard")
    await mkdir(guard)
    const controller = new AbortController()
    const pending = getReplicaObject(directory, hash("first"), repo, controller.signal)
    const timer = setTimeout(() => controller.abort(new Error("lookup cancelled")), 10)
    try { await expect(pending).rejects.toThrow("lookup cancelled") }
    finally { clearTimeout(timer); await rm(guard, { recursive: true }) }
    expect(await getReplicaObject(directory, hash("first"), repo)).toEqual(Buffer.from("first"))
  }))

  it("holds a read guard across all objects while another process requests eviction", async () => fixture(async directory => {
    const store = path.join(directory, "store")
    const original = bundle({ "a": "first", "b": "second" })
    const oldArtifact = await storeReplicaBundle(store, original)
    const worker = path.join(directory, "reader.mjs")
    await build({ stdin: { contents: `import fs from 'node:fs/promises'; import { readReplicaBundle } from ${JSON.stringify(path.resolve("packages/core/src/semantic/replica-source-store.ts"))}; const originalOpen = fs.open; let paused=false; fs.open = async (...args) => { const handle=await originalOpen(...args); if (!paused && String(args[0]).includes('.replica-objects')) { paused=true; const read=handle.read.bind(handle); let first=true; handle.read=async (...readArgs)=>{ if(first){ first=false; process.stdout.write('reading\\n'); await new Promise(resolve=>process.stdin.once('data',resolve)); } return read(...readArgs); }; } return handle; }; const value=await readReplicaBundle(process.argv[2], JSON.parse(process.argv[3])); process.stdout.write(JSON.stringify(value)+'\\n');`, resolveDir: process.cwd(), loader: "ts" }, outfile: worker, bundle: true, platform: "node", format: "esm", logLevel: "silent" })
    const child = spawn(process.execPath, [worker, oldArtifact, JSON.stringify({ repositoryId: repo, snapshotId: original.snapshotId })], { stdio: ["pipe", "pipe", "pipe"] })
    let output = "", error = ""
    const ready = new Promise<void>((resolve, reject) => {
      child.stdout.on("data", data => { output += data; if (output.startsWith("reading\n")) resolve() })
      child.stderr.on("data", data => { error += data })
      child.once("error", reject); child.once("exit", code => { if (!output.startsWith("reading\n")) reject(new Error(`reader exited early ${code}: ${error}`)) })
    })
    const finished = new Promise<void>((resolve, reject) => { child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(new Error(`reader failed ${code}: ${error}`))) })
    try {
      await ready
      let published = false
      const next = storeReplicaBundle(store, bundle({ "c": "third" }), { retainSnapshots: 1, maxBytes: 5 }).then(value => { published = true; return value })
      await new Promise(resolve => setTimeout(resolve, 40))
      expect(published).toBe(false)
      child.stdin.end("resume\n")
      await finished; await next
      expect(JSON.parse(output.split("\n")[1])).toEqual(original)
      await expect(readFile(oldArtifact)).rejects.toMatchObject({ code: "ENOENT" })
    } finally { if (child.exitCode === null) { child.kill(); await finished.catch(() => {}) } }
  }))
})
