import { createHash, timingSafeEqual } from "node:crypto"
import { createServer, request, type Server } from "node:http"
import fs from "node:fs/promises"
import { constants } from "node:fs"
import { readProjectSource } from "../file/source-reader.js"
import { sourceContentHash, validateSourceRange } from "../file/source-reader.js"
import { createResultId, decodeResultId, type ResultLocation } from "../tool/result-id.js"
import { readRepositoryId } from "../project/repository-identity.js"
import { VectorStore } from "./lancedb.js"
import { GenerationLeases } from "./generation-leases.js"
import { readSourceObject } from "./source-object-store.js"
import { sourceSnapshotId, validateSourceManifest, type SourceManifest } from "./source-manifest.js"
import { getReplicaObject, putReplicaObject, storeReplicaBundle, readReplicaBundle } from "./replica-source-store.js"

const MAX_BUNDLE_BYTES = 32 * 1024 * 1024
const MAX_FILES = 10_000
const MAX_FILE_BYTES = 2 * 1024 * 1024
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex")

/** Immutable bytes for the indexed-file universe; this is not an index or a full repository snapshot. */
export type SourceBundle = {
  version: 1
  manifest: SourceManifest
  snapshotId: string
  files: Array<{ path: string; contentBase64: string }>
}

/** Capture only when each live file still matches the source represented by the index. */
export async function captureSourceBundle(root: string, manifestInput: SourceManifest, objectDirectory?: string): Promise<SourceBundle> {
  const manifest = validateSourceManifest(manifestInput)
  if (manifest.files.length > MAX_FILES) throw new Error("Snapshot exceeds file limit")
  let bytes = 0
  const files: SourceBundle["files"] = []
  for (const entry of manifest.files) {
    let raw: Buffer | undefined
    if (objectDirectory) {
      try { raw = await readSourceObject(objectDirectory, entry.sha256, { maxBytes: MAX_FILE_BYTES }) }
      catch (error: any) { if (error?.code !== "ENOENT") throw error }
    }
    if (!raw) {
      const source = await readProjectSource(root, entry.path, { maxBytes: MAX_FILE_BYTES })
      if (source.rawSha256 !== entry.sha256) throw new Error(`Indexed source changed and historical bytes are unavailable: ${entry.path}; refresh the index before capture`)
      raw = source.rawBytes
    }
    bytes += raw.length
    if (bytes > MAX_BUNDLE_BYTES) throw new Error("Snapshot exceeds byte limit")
    files.push({ path: entry.path, contentBase64: raw.toString("base64") })
  }
  return { version: 1, manifest, snapshotId: sourceSnapshotId(manifest), files }
}

/** Resolve an explicitly registered index, then capture its live matching bytes. */
export async function captureIndexedSourceBundle(root: string): Promise<SourceBundle> {
  const repositoryId = await readRepositoryId(root)
  const meta = await VectorStore.readIndexMeta(root)
  if (!repositoryId || !meta?.sourceSnapshot || meta.sourceSnapshot.manifest.repositoryId !== repositoryId) throw new Error("Indexed source snapshot unavailable; register the repository and publish a compatible index first")
  const generation = meta.tableName ?? "chunks"
  const release = await new GenerationLeases(VectorStore.getIndexStoragePath(root), generation).acquire()
  try {
    if (!(await VectorStore.inspectCollectionSchema(root, generation)).exists) throw new Error("Indexed generation is unavailable; refresh the index before capture")
    return await captureSourceBundle(root, meta.sourceSnapshot.manifest, VectorStore.getIndexStoragePath(root))
  } finally { await release() }
}

/** Validate all content before a caller stores or uses the bundle. */
export function validateSourceBundle(input: unknown, expected: { repositoryId: string; snapshotId: string }): SourceBundle {
  if (!input || typeof input !== "object") throw new Error("Invalid snapshot bundle")
  const bundle = input as SourceBundle
  const manifest = validateSourceManifest(bundle.manifest)
  if (bundle.version !== 1 || manifest.repositoryId !== expected.repositoryId || bundle.snapshotId !== expected.snapshotId || sourceSnapshotId(manifest) !== bundle.snapshotId) throw new Error("Snapshot identity mismatch")
  if (!Array.isArray(bundle.files) || bundle.files.length !== manifest.files.length || bundle.files.length > MAX_FILES) throw new Error("Snapshot file list mismatch")
  let bytes = 0
  for (let i = 0; i < manifest.files.length; i++) {
    const entry = manifest.files[i], file = bundle.files[i]
    if (!file || file.path !== entry.path || typeof file.contentBase64 !== "string" || file.contentBase64.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.contentBase64)) throw new Error("Snapshot content mismatch")
    const raw = Buffer.from(file.contentBase64, "base64")
    if (raw.toString("base64") !== file.contentBase64 || digest(raw) !== entry.sha256) throw new Error("Snapshot content mismatch")
    const size = raw.length
    if (size > MAX_FILE_BYTES || (bytes += size) > MAX_BUNDLE_BYTES) throw new Error("Snapshot exceeds byte limit")
  }
  return { version: 1, manifest, snapshotId: bundle.snapshotId, files: bundle.files.map(({ path, contentBase64 }) => ({ path, contentBase64 })) }
}

/** Explicitly store validated immutable source bytes; no index is activated. */
export async function storeSourceBundle(directory: string, input: unknown, expected: { repositoryId: string; snapshotId: string }): Promise<string> {
  const bundle = validateSourceBundle(input, expected)
  return storeReplicaBundle(directory, bundle)
}

export async function readStoredSourceBundle(filename: string, expected: { repositoryId: string; snapshotId: string }): Promise<SourceBundle> {
  if ((await fs.lstat(filename)).isSymbolicLink()) throw new Error("Snapshot artifact cannot be a symbolic link")
  const handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > MAX_BUNDLE_BYTES * 2) throw new Error("Snapshot artifact exceeds limits or is not a file")
    const buffer = Buffer.allocUnsafe(stat.size + 1)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    if (offset !== stat.size) throw new Error("Snapshot artifact changed while reading")
    const stored = JSON.parse(buffer.subarray(0, offset).toString("utf8"))
    if (stored?.storage === "source-replica-v1") return validateSourceBundle(await readReplicaBundle(filename, expected), expected)
    return validateSourceBundle(stored, expected)
  } finally { await handle.close() }
}

function bundleRange(bundle: SourceBundle, location: ResultLocation): string {
  const entry = bundle.files.find(file => file.path === location.file)
  if (!entry) throw new Error("Source is unavailable in this indexed snapshot")
  const source = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(entry.contentBase64, "base64"))
  const lines = source.split(/\r?\n/)
  validateSourceRange(lines, location.startLine, location.endLine)
  return lines.slice(location.startLine - 1, location.endLine).join("\n")
}

/** Explicitly bind a location to verified immutable source, not to an index spec. */
export function createPortableResultId(bundle: SourceBundle, location: ResultLocation): string {
  const checked = validateSourceBundle(bundle, { repositoryId: bundle.manifest.repositoryId, snapshotId: bundle.snapshotId })
  const content = bundleRange(checked, location)
  if (location.sourceHash && location.sourceHash !== sourceContentHash(content)) throw new Error("Result content does not match snapshot")
  return createResultId({ ...location, sourceHash: sourceContentHash(content), repositoryId: checked.manifest.repositoryId, snapshotId: checked.snapshotId })
}

/** Resolve a transferred reference only against the explicitly selected compatible bundle. */
export function readPortableResult(bundle: unknown, resultId: string, expectedRepositoryId: string): { location: ResultLocation; content: string } {
  const location = decodeResultId(resultId)
  if (!location.repositoryId || !location.snapshotId || !location.sourceHash || location.repositoryId !== expectedRepositoryId) throw new Error("Portable reference identity is missing or incompatible")
  const checked = validateSourceBundle(bundle, { repositoryId: expectedRepositoryId, snapshotId: location.snapshotId })
  const content = bundleRange(checked, location)
  if (sourceContentHash(content) !== location.sourceHash) throw new Error("Portable reference content mismatch")
  return { location, content }
}

function sameSecret(expected: string, actual: string): boolean {
  const left = Buffer.from(expected), right = Buffer.from(actual)
  return left.length === right.length && timingSafeEqual(left, right)
}

function validSecret(secret: string): boolean {
  return Buffer.byteLength(secret) >= 32 && Buffer.byteLength(secret) <= 512 && /^[\x21-\x7e]+$/.test(secret)
}

/** Serve one explicitly selected bundle on loopback only. Use a trusted encrypted tunnel between machines. */
export async function serveSourceBundle(bundle: SourceBundle, secret: string): Promise<{ server: Server; port: number }> {
  if (!validSecret(secret)) throw new Error("Snapshot transport requires a 32–512 byte printable ASCII secret")
  const validated = validateSourceBundle(bundle, { repositoryId: bundle.manifest.repositoryId, snapshotId: bundle.snapshotId })
  const objects = new Map(validated.manifest.files.map((entry, i) => [entry.sha256, Buffer.from(validated.files[i].contentBase64, "base64")]))
  const manifest = validated.manifest, snapshotId = validated.snapshotId
  const manifestPayload = JSON.stringify({ protocol: 2, snapshotId, manifest })
  if (Buffer.byteLength(manifestPayload) > 4 * 1024 * 1024) throw new Error("Encoded snapshot manifest exceeds byte limit")
  let legacyPayload: string | undefined
  const server = createServer((req, res) => {
    const deadline = setTimeout(() => res.destroy(new Error("Snapshot response deadline exceeded")), 30_000)
    res.on("close", () => clearTimeout(deadline))
    res.setHeader("cache-control", "no-store")
    const authorization = String(req.headers.authorization ?? "")
    if (!authorization.startsWith("Bearer ") || !sameSecret(secret, authorization.slice(7))) { res.writeHead(401); res.end(); return }
    if (req.method !== "GET") { res.writeHead(404); res.end(); return }
    if (req.url === "/v1/snapshot" || req.url === "/v2/manifest") {
      if (req.url === "/v1/snapshot" && !legacyPayload) legacyPayload = JSON.stringify({ version: 1, manifest, snapshotId, files: manifest.files.map(entry => ({ path: entry.path, contentBase64: objects.get(entry.sha256)!.toString("base64") })) })
      const body = req.url === "/v1/snapshot" ? legacyPayload! : manifestPayload
      res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body) }); res.end(body); return
    }
    const hash = /^\/v2\/objects\/([a-f0-9]{64})$/.exec(req.url ?? "")?.[1]
    const object = hash ? objects.get(hash) : undefined
    if (!object) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { "content-type": "application/octet-stream", "content-length": object.length }); res.end(object)
  })
  server.maxConnections = 16
  server.headersTimeout = 10_000
  server.requestTimeout = 30_000
  server.keepAliveTimeout = 1_000
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") { server.close(); throw new Error("Snapshot listener failed") }
  return { server, port: address.port }
}

/** Fetch through loopback only, e.g. a separately authorized encrypted tunnel. */
async function fetchSnapshotBytes(port: number, secret: string, route: string, maxBytes: number, deadlineAt: number, signal?: AbortSignal): Promise<{ status: number; bytes: Buffer }> {
  signal?.throwIfAborted()
  const remaining = deadlineAt - Date.now()
  if (remaining <= 0) throw new Error("Snapshot request deadline exceeded")
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: route, headers: { authorization: `Bearer ${secret}` }, signal }, res => {
      const chunks: Buffer[] = []; let bytes = 0
      res.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > maxBytes) { res.destroy(new Error("Snapshot exceeds transport limit")); return }; chunks.push(chunk) })
      res.on("error", reject)
      res.on("end", () => resolve({ status: res.statusCode ?? 0, bytes: Buffer.concat(chunks) }))
      res.on("aborted", () => reject(new Error("Snapshot transfer interrupted")))
    })
    const deadline = setTimeout(() => req.destroy(new Error("Snapshot request deadline exceeded")), remaining)
    req.setTimeout(remaining, () => req.destroy(new Error("Snapshot request timed out")))
    req.on("close", () => clearTimeout(deadline))
    req.on("error", reject); req.end()
  })
}

/** Protocol v2 transfers only missing immutable objects. v1 remains readable. */
export async function fetchSourceBundle(port: number, secret: string, expected: { repositoryId: string; snapshotId: string }, signal?: AbortSignal, replicaDirectory?: string): Promise<SourceBundle> {
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !validSecret(secret)) throw new Error("Invalid snapshot endpoint or credential")
  const deadlineAt = Date.now() + 30_000
  signal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30_000)])
  const response = await fetchSnapshotBytes(port, secret, "/v2/manifest", MAX_BUNDLE_BYTES * 2, deadlineAt, signal)
  if (response.status === 404) {
    const legacy = await fetchSnapshotBytes(port, secret, "/v1/snapshot", MAX_BUNDLE_BYTES * 2, deadlineAt, signal)
    if (legacy.status !== 200) throw new Error(`Snapshot request rejected (${legacy.status})`)
    signal.throwIfAborted()
    return validateSourceBundle(JSON.parse(legacy.bytes.toString("utf8")), expected)
  }
  if (response.status !== 200) throw new Error(`Snapshot request rejected (${response.status})`)
  const wire = JSON.parse(response.bytes.toString("utf8"))
  const manifest = validateSourceManifest(wire.manifest)
  if (wire.protocol !== 2 || wire.snapshotId !== expected.snapshotId || manifest.repositoryId !== expected.repositoryId || sourceSnapshotId(manifest) !== expected.snapshotId || manifest.files.length > MAX_FILES) throw new Error("Snapshot identity or protocol mismatch")
  const files: SourceBundle["files"] = []
  const received = new Map<string, Buffer>()
  let bytes = 0
  for (const entry of manifest.files) {
    signal?.throwIfAborted()
    if (Date.now() >= deadlineAt) throw new Error("Snapshot request deadline exceeded")
    let raw = received.get(entry.sha256) ?? (replicaDirectory ? await getReplicaObject(replicaDirectory, entry.sha256, expected.repositoryId, signal) : undefined)
    if (!raw) {
      const object = await fetchSnapshotBytes(port, secret, `/v2/objects/${entry.sha256}`, MAX_FILE_BYTES, deadlineAt, signal)
      if (object.status !== 200 || digest(object.bytes) !== entry.sha256) throw new Error("Snapshot object unavailable or corrupt")
      raw = object.bytes
      if (replicaDirectory) await putReplicaObject(replicaDirectory, expected.repositoryId, entry.sha256, raw, { signal })
    }
    if (raw.length > MAX_FILE_BYTES || (bytes += raw.length) > MAX_BUNDLE_BYTES) throw new Error("Snapshot exceeds byte limit")
    received.set(entry.sha256, raw)
    files.push({ path: entry.path, contentBase64: raw.toString("base64") })
  }
  signal.throwIfAborted()
  return validateSourceBundle({ version: 1, manifest, snapshotId: expected.snapshotId, files }, expected)
}
