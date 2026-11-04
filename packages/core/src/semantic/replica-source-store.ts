import { createHash, randomUUID } from "node:crypto"
import { constants } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { validateRepositoryId, validateSourceManifest, sourceSnapshotId, type SourceManifest } from "./source-manifest.js"
import { withSharedSourceGuard } from "./shared-source-retention.js"

const HASH = /^[a-f0-9]{64}$/
const MAX_FILE = 2 * 1024 * 1024
const MAX_BUNDLE = 32 * 1024 * 1024
const MAX_MANIFEST = 4 * 1024 * 1024
export type ReplicaBundle = { version: 1; manifest: SourceManifest; snapshotId: string; files: Array<{ path: string; contentBase64: string }> }
export type ReplicaArtifact = { version: 1; storage: "source-replica-v1"; manifest: SourceManifest; snapshotId: string }
export type ReplicaOptions = { maxBytes?: number; retainSnapshots?: number; signal?: AbortSignal }
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex")
const objects = (directory: string) => path.join(directory, ".replica-objects", "sha256")
const pinFile = (directory: string, id: string) => path.join(directory, ".replica-pins", `${snapshotHash(id)}.json`)
function snapshotHash(id: string): string {
  if (!/^sha256:[a-f0-9]{64}$/.test(id)) throw new Error("Invalid replica snapshot identity")
  return id.slice(7)
}
function configured(value: number | undefined, env: string, fallback: number): number {
  const result = value ?? (process.env[env] === undefined ? fallback : Number(process.env[env]))
  if (!Number.isSafeInteger(result) || result < 0) throw new RangeError(`Invalid ${env}`)
  return result
}
async function privateDirectory(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  const stat = await fs.stat(directory)
  if (!stat.isDirectory() || (process.platform !== "win32" && ((stat.mode & 0o077) !== 0 || (typeof process.getuid === "function" && stat.uid !== process.getuid())))) throw new Error("Replica destination must be a private directory owned by the current user")
  for (const relative of [".replica-objects", path.join(".replica-objects", "sha256"), ".replica-pins"]) {
    try {
      const child = await fs.lstat(path.join(directory, relative))
      if (!child.isDirectory() || child.isSymbolicLink()) throw new Error("Unsafe replica storage directory")
    } catch (error: any) { if (error?.code !== "ENOENT") throw error }
  }
}
async function boundedRead(filename: string, maxBytes: number): Promise<Buffer> {
  const first = await fs.lstat(filename)
  if (!first.isFile() || first.isSymbolicLink()) throw new Error("Unsafe replica file")
  const handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > maxBytes) throw new Error("Replica file exceeds limits")
    const result = Buffer.allocUnsafe(stat.size + 1)
    let offset = 0
    while (offset < result.length) { const { bytesRead } = await handle.read(result, offset, result.length - offset, offset); if (!bytesRead) break; offset += bytesRead }
    if (offset !== stat.size) throw new Error("Replica file changed while reading")
    return result.subarray(0, offset)
  } finally { await handle.close() }
}
async function publish(filename: string, bytes: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 })
  const temporary = path.join(path.dirname(filename), `.${randomUUID()}.tmp`)
  try {
    const handle = await fs.open(temporary, "wx", 0o600)
    try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
    try { await fs.link(temporary, filename) }
    catch (error: any) {
      if (error?.code !== "EEXIST") throw error
      if (!(await boundedRead(filename, Math.max(MAX_MANIFEST, bytes.length))).equals(bytes)) throw new Error("Existing immutable replica artifact is incompatible")
    }
  } finally { await fs.unlink(temporary).catch(() => {}) }
}
async function bind(directory: string, repositoryId: string): Promise<void> {
  validateRepositoryId(repositoryId)
  const filename = path.join(directory, ".replica-repository.json")
  const data = Buffer.from(JSON.stringify({ version: 1, repositoryId }))
  await publish(filename, data)
}
async function repository(directory: string): Promise<string | undefined> {
  try {
    const value = JSON.parse((await boundedRead(path.join(directory, ".replica-repository.json"), 1024)).toString("utf8"))
    if (value.version !== 1 || typeof value.repositoryId !== "string") throw new Error("Invalid replica repository binding")
    validateRepositoryId(value.repositoryId); return value.repositoryId
  } catch (error: any) { if (error?.code === "ENOENT") return undefined; throw error }
}
function artifact(input: unknown, expected?: { repositoryId: string; snapshotId: string }): ReplicaArtifact {
  if (!input || typeof input !== "object") throw new Error("Invalid replica manifest")
  const value = input as ReplicaArtifact
  const manifest = validateSourceManifest(value.manifest)
  if (value.version !== 1 || value.storage !== "source-replica-v1" || manifest.files.length > 10_000 || value.snapshotId !== sourceSnapshotId(manifest) || (expected && (manifest.repositoryId !== expected.repositoryId || value.snapshotId !== expected.snapshotId))) throw new Error("Replica snapshot identity mismatch")
  return { version: 1, storage: "source-replica-v1", manifest, snapshotId: value.snapshotId }
}
async function readObject(directory: string, sha256: string): Promise<Buffer | undefined> {
  if (!HASH.test(sha256)) throw new Error("Invalid replica object identity")
  try {
    const bytes = await boundedRead(path.join(objects(directory), sha256), MAX_FILE)
    if (digest(bytes) !== sha256) throw new Error("Replica object content mismatch")
    return bytes
  } catch (error: any) { if (error?.code === "ENOENT") return undefined; throw error }
}
async function manifests(directory: string): Promise<Array<{ file: string; value: ReplicaArtifact; time: number }>> {
  const result = []
  const binding = await repository(directory)
  for (const file of (await fs.readdir(directory)).filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
    const filename = path.join(directory, file)
    const value = artifact(JSON.parse((await boundedRead(filename, MAX_MANIFEST)).toString("utf8")))
    if (file !== `${snapshotHash(value.snapshotId)}.json` || binding !== value.manifest.repositoryId) throw new Error("Replica manifest binding mismatch")
    result.push({ file, value, time: (await fs.stat(filename)).mtimeMs })
  }
  return result
}
async function pins(directory: string): Promise<Set<string>> {
  let names: string[]
  try { names = await fs.readdir(path.join(directory, ".replica-pins")) } catch (error: any) { if (error?.code === "ENOENT") return new Set(); throw error }
  const result = new Set<string>()
  for (const name of names) {
    if (/^\.[a-f0-9-]{36}\.tmp$/.test(name)) {
      const filename = path.join(directory, ".replica-pins", name)
      const stat = await fs.lstat(filename)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Unsafe temporary replica pin")
      await fs.unlink(filename); continue
    }
    if (!/^[a-f0-9]{64}\.json$/.test(name)) throw new Error("Unknown replica pin")
    const value = JSON.parse((await boundedRead(path.join(directory, ".replica-pins", name), 1024)).toString("utf8"))
    if (value.version !== 1 || typeof value.snapshotId !== "string" || `${snapshotHash(value.snapshotId)}.json` !== name) throw new Error("Invalid replica pin")
    result.add(value.snapshotId)
  }
  return result
}
async function prune(directory: string, options: ReplicaOptions, incoming?: { id: string; bytes: Map<string, Buffer> }): Promise<{ removedSnapshots: number; removedObjects: number; bytes: number }> {
  const maxBytes = configured(options.maxBytes, "SENSEGREP_REPLICA_MAX_BYTES", 512 * 1024 * 1024)
  const retain = Math.max(1, configured(options.retainSnapshots, "SENSEGREP_REPLICA_RETAIN_SNAPSHOTS", 8))
  for (const name of await fs.readdir(directory)) {
    if (!/^\.[a-f0-9-]{36}\.tmp$/.test(name)) continue
    const filename = path.join(directory, name)
    const stat = await fs.lstat(filename)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Unsafe temporary replica manifest")
    await fs.unlink(filename)
  }
  const pinned = await pins(directory)
  const entries = (await manifests(directory)).sort((a, b) => b.time - a.time)
  const keep = new Set<string>([...pinned, ...(incoming?.id ? [incoming.id] : [])])
  let ordinary = incoming?.id && !pinned.has(incoming.id) ? 1 : 0
  for (const entry of entries) { if (keep.has(entry.value.snapshotId)) continue; if (ordinary++ < retain) keep.add(entry.value.snapshotId) }
  let removedSnapshots = 0
  for (const entry of entries) if (!keep.has(entry.value.snapshotId)) { await fs.unlink(path.join(directory, entry.file)); removedSnapshots++ }
  const referenced = new Set(entries.filter(entry => keep.has(entry.value.snapshotId)).flatMap(entry => entry.value.manifest.files.map(file => file.sha256)))
  for (const sha of incoming?.bytes.keys() ?? []) referenced.add(sha)
  let names: string[]
  try { names = await fs.readdir(objects(directory)) } catch (error: any) { if (error?.code === "ENOENT") names = []; else throw error }
  const objectsOnDisk = []
  for (const name of names) {
    const filename = path.join(objects(directory), name)
    if (/^\.[a-f0-9-]{36}\.tmp$/.test(name)) { const stat = await fs.lstat(filename); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Unsafe temporary replica object"); await fs.unlink(filename); continue }
    if (!HASH.test(name)) throw new Error("Unknown replica object")
    const stat = await fs.lstat(filename)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE) throw new Error("Unsafe replica object")
    objectsOnDisk.push({ name, size: stat.size, time: stat.mtimeMs })
  }
  const existing = new Set(objectsOnDisk.map(entry => entry.name))
  let bytes = objectsOnDisk.reduce((sum, entry) => sum + entry.size, 0) + [...incoming?.bytes ?? []].reduce((sum, [sha, raw]) => sum + (existing.has(sha) ? 0 : raw.length), 0)
  let removedObjects = 0
  for (const entry of objectsOnDisk.sort((a, b) => a.time - b.time)) {
    options.signal?.throwIfAborted()
    if (referenced.has(entry.name) || bytes <= maxBytes) continue
    await fs.unlink(path.join(objects(directory), entry.name)); bytes -= entry.size; removedObjects++
  }
  if (bytes > maxBytes) throw new Error(`Replica source budget exceeded (${bytes} > ${maxBytes}); release retained snapshots or increase the budget`)
  return { removedSnapshots, removedObjects, bytes }
}

export async function verifyReplicaRepository(directory: string, repositoryId: string): Promise<void> {
  await privateDirectory(directory)
  await withSharedSourceGuard(directory, () => bind(directory, repositoryId))
}
export async function getReplicaObject(directory: string, sha256: string, repositoryId?: string, signal?: AbortSignal): Promise<Buffer | undefined> {
  signal?.throwIfAborted()
  await privateDirectory(directory)
  return withSharedSourceGuard(directory, async () => {
    const actual = await repository(directory)
    if (repositoryId && actual && actual !== repositoryId) throw new Error("Replica repository identity mismatch")
    const result = actual ? await readObject(directory, sha256) : undefined
    signal?.throwIfAborted()
    return result
  }, signal)
}
export async function putReplicaObject(directory: string, repositoryId: string, sha256: string, bytes: Buffer, options: ReplicaOptions = {}): Promise<void> {
  const immutable = Buffer.from(bytes)
  if (!HASH.test(sha256) || immutable.length > MAX_FILE || digest(immutable) !== sha256) throw new Error("Replica object content mismatch")
  await privateDirectory(directory)
  await withSharedSourceGuard(directory, async () => {
    await bind(directory, repositoryId)
    await prune(directory, options, { id: "", bytes: new Map([[sha256, immutable]]) })
    const existing = await readObject(directory, sha256)
    if (!existing) await publish(path.join(objects(directory), sha256), immutable)
    options.signal?.throwIfAborted()
  }, options.signal)
}
export async function storeReplicaBundle(directory: string, input: ReplicaBundle, options: ReplicaOptions = {}): Promise<string> {
  const value = artifact({ ...input, storage: "source-replica-v1" })
  if (!Array.isArray(input.files) || input.files.length !== value.manifest.files.length) throw new Error("Replica file list mismatch")
  const bytes = new Map<string, Buffer>(); let total = 0
  for (let index = 0; index < input.files.length; index++) {
    const file = input.files[index], expected = value.manifest.files[index]
    if (file.path !== expected.path || typeof file.contentBase64 !== "string" || file.contentBase64.length > Math.ceil(MAX_FILE / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.contentBase64)) throw new Error("Replica content mismatch")
    const raw = Buffer.from(file.contentBase64, "base64")
    if (raw.length > MAX_FILE || raw.toString("base64") !== file.contentBase64 || digest(raw) !== expected.sha256 || (total += raw.length) > MAX_BUNDLE) throw new Error("Replica content mismatch or byte limit exceeded")
    bytes.set(expected.sha256, raw)
  }
  const data = Buffer.from(JSON.stringify(value))
  if (data.length > MAX_MANIFEST) throw new Error("Replica manifest exceeds byte limit")
  await privateDirectory(directory)
  return withSharedSourceGuard(directory, async () => {
    await bind(directory, value.manifest.repositoryId)
    await prune(directory, options, { id: value.snapshotId, bytes })
    for (const [sha, raw] of bytes) { options.signal?.throwIfAborted(); if (!await readObject(directory, sha)) await publish(path.join(objects(directory), sha), raw) }
    const filename = path.join(directory, `${snapshotHash(value.snapshotId)}.json`)
    await publish(filename, data)
    await fs.utimes(filename, new Date(), new Date())
    return filename
  }, options.signal)
}
export async function readReplicaBundle(filename: string, expected: { repositoryId: string; snapshotId: string }): Promise<ReplicaBundle> {
  const directory = path.dirname(path.resolve(filename))
  await privateDirectory(directory)
  return withSharedSourceGuard(directory, async () => {
    const value = artifact(JSON.parse((await boundedRead(filename, MAX_MANIFEST)).toString("utf8")), expected)
    if (await repository(directory) !== expected.repositoryId || path.basename(filename) !== `${snapshotHash(expected.snapshotId)}.json`) throw new Error("Replica artifact binding mismatch")
    const files = []; let total = 0
    for (const file of value.manifest.files) {
      const raw = await readObject(directory, file.sha256)
      if (!raw) throw new Error("Replica source object is unavailable")
      if ((total += raw.length) > MAX_BUNDLE) throw new Error("Replica exceeds byte limit")
      files.push({ path: file.path, contentBase64: raw.toString("base64") })
    }
    return { version: 1, manifest: value.manifest, snapshotId: value.snapshotId, files }
  })
}
export async function collectReplicaObjects(directory: string, options: ReplicaOptions = {}) {
  await privateDirectory(directory)
  return withSharedSourceGuard(directory, () => prune(directory, options), options.signal)
}
export async function pinReplicaSnapshot(directory: string, snapshotId: string): Promise<void> {
  await privateDirectory(directory)
  await withSharedSourceGuard(directory, async () => {
    const value = artifact(JSON.parse((await boundedRead(path.join(directory, `${snapshotHash(snapshotId)}.json`), MAX_MANIFEST)).toString("utf8")))
    if (value.snapshotId !== snapshotId) throw new Error("Replica pin identity mismatch")
    await publish(pinFile(directory, snapshotId), Buffer.from(JSON.stringify({ version: 1, snapshotId })))
  })
}
export async function unpinReplicaSnapshot(directory: string, snapshotId: string): Promise<void> {
  await privateDirectory(directory)
  await withSharedSourceGuard(directory, () => fs.rm(pinFile(directory, snapshotId), { force: true }))
}

export async function removeReplicaSnapshot(directory: string, snapshotId: string): Promise<void> {
  await privateDirectory(directory)
  await withSharedSourceGuard(directory, async () => {
    if ((await pins(directory)).has(snapshotId)) throw new Error("Replica snapshot is explicitly pinned")
    await fs.rm(path.join(directory, `${snapshotHash(snapshotId)}.json`), { force: true })
  })
}
