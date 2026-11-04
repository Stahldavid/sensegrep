import { createHash, randomUUID } from "node:crypto"
import { constants } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { Instance } from "../project/instance.js"
import { sharedRepositoryScope, sharedSourceDirectory } from "../project/repository-sharing.js"
import { admitSharedSource, withSharedSourceGuard } from "./shared-source-retention.js"

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024
export type SourceObjectOptions = { maxBytes?: number; signal?: AbortSignal }
export class SourceObjectError extends Error {
  constructor(readonly code: "ENOENT" | "source-object-corrupt" | "source-object-too-large" | "unsafe-source-object", message: string) {
    super(message)
    this.name = "SourceObjectError"
  }
}
function objectPath(indexDirectory: string, sha256: string): string {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new SourceObjectError("source-object-corrupt", "Invalid source object SHA-256")
  return path.join(indexDirectory, ".source-objects", "sha256", sha256)
}
function byteLimit(options: SourceObjectOptions): number {
  const value = options.maxBytes ?? DEFAULT_MAX_BYTES
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("Invalid source object byte limit")
  return value
}
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex")

/** Bounded verified reads. The object store retains original bytes, including BOM and CRLF. */
export async function readSourceObject(indexDirectory: string, sha256: string, options: SourceObjectOptions = {}): Promise<Buffer> {
  return readObjectAt(objectPath(indexDirectory, sha256), sha256, options)
}

async function readObjectAt(filename: string, sha256: string, options: SourceObjectOptions): Promise<Buffer> {
  options.signal?.throwIfAborted()
  const maxBytes = byteLimit(options)
  let handle: Awaited<ReturnType<typeof fs.open>>
  try {
    const stat = await fs.lstat(filename)
    if (stat.isSymbolicLink() || !stat.isFile()) throw new SourceObjectError("unsafe-source-object", "Source object must be a regular file")
    handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  } catch (error: any) {
    if (error?.code === "ENOENT") throw new SourceObjectError("ENOENT", `Historical source object ${sha256} is unavailable; use validated live content or rebuild its source snapshot`)
    throw error
  }
  try {
    const before = await handle.stat()
    if (!before.isFile()) throw new SourceObjectError("unsafe-source-object", "Source object must be a regular file")
    if (before.size > maxBytes) throw new SourceObjectError("source-object-too-large", "Source object exceeds byte limit")
    const bytes = Buffer.allocUnsafe(before.size + 1)
    let offset = 0
    while (offset < bytes.length) {
      options.signal?.throwIfAborted()
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    options.signal?.throwIfAborted()
    const result = bytes.subarray(0, offset)
    if (offset !== before.size || digest(result) !== sha256) throw new SourceObjectError("source-object-corrupt", "Historical source object changed or has an invalid digest")
    return result
  } finally { await handle.close() }
}

/** Publish an immutable source object before publishing metadata that references it.
 * Objects may be repository-shared with per-view hardlinks. Generation references
 * and publication pins govern collection; raw objects are never evicted while referenced.
 */
export async function writeSourceObject(indexDirectory: string, rawBytes: Buffer, options: SourceObjectOptions & { expectedSha256?: string } = {}): Promise<string> {
  options.signal?.throwIfAborted()
  const bytes = Buffer.from(rawBytes)
  if (bytes.length > byteLimit(options)) throw new SourceObjectError("source-object-too-large", "Source object exceeds byte limit")
  const sha256 = digest(bytes)
  if (options.expectedSha256 !== undefined && options.expectedSha256 !== sha256) throw new SourceObjectError("source-object-corrupt", "Source object does not match the indexed digest")
  const filename = objectPath(indexDirectory, sha256)
  const repository = await sharedRepositoryScope(Instance.directory)
  if (repository) {
    const sharedDirectory = sharedSourceDirectory(repository)
    const shared = path.join(sharedDirectory, sha256)
    await withSharedSourceGuard(sharedDirectory, async () => {
      await admitSharedSource(sharedDirectory, sha256, bytes.length, { signal: options.signal })
      await publishObject(shared, bytes, sha256, options)
      await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 })
      try { await fs.link(shared, filename) }
      catch (error: any) {
        if (error?.code === "EEXIST") await readObjectAt(filename, sha256, options)
        else if (error?.code === "EXDEV") await publishObject(filename, bytes, sha256, options)
        else throw error
      }
    }, options.signal)
    options.signal?.throwIfAborted()
    return sha256
  }
  await publishObject(filename, bytes, sha256, options)
  return sha256
}

async function publishObject(filename: string, bytes: Buffer, sha256: string, options: SourceObjectOptions): Promise<void> {
  await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 })
  const temporary = `${filename}.${randomUUID()}.tmp`
  try {
    const handle = await fs.open(temporary, "wx", 0o600)
    try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
    options.signal?.throwIfAborted()
    try { await fs.link(temporary, filename) }
    catch (error: any) {
      if (error?.code !== "EEXIST") throw error
      // Never replace an existing object, including a corrupt or unsafe one.
      await readObjectAt(filename, sha256, options)
    }
    options.signal?.throwIfAborted()
  } finally { await fs.unlink(temporary).catch(() => {}) }
}

/** Pin known repository source objects into a new checkout view before metadata publication.
 * Missing shared objects remain explicitly unavailable; no file paths or live source are inferred.
 */
export async function linkSharedSourceObjects(
  indexDirectory: string,
  root: string,
  files: Record<string, { sourceSha256?: string; sourceHashKind?: string }>,
  signal?: AbortSignal,
): Promise<{ linked: number; unavailable: number }> {
  const repository = await sharedRepositoryScope(root)
  if (!repository) return { linked: 0, unavailable: 0 }
  const hashes = [...new Set(Object.values(files).filter(file => file.sourceHashKind === "sha256-raw-v1" && file.sourceSha256).map(file => file.sourceSha256!))]
  const directory = sharedSourceDirectory(repository)
  let linked = 0, unavailable = 0
  await withSharedSourceGuard(directory, async () => {
    for (const sha256 of hashes) {
      signal?.throwIfAborted()
      const filename = objectPath(indexDirectory, sha256)
      const shared = path.join(directory, sha256)
      let bytes: Buffer
      try { bytes = await readObjectAt(shared, sha256, { signal }) }
      catch (error: any) { if (error?.code === "ENOENT") { unavailable++; continue }; throw error }
      await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 })
      try { await fs.link(shared, filename); linked++ }
      catch (error: any) {
        if (error?.code === "EEXIST") await readObjectAt(filename, sha256, { signal })
        else if (error?.code === "EXDEV") { await publishObject(filename, bytes, sha256, { signal }); linked++ }
        else throw error
      }
    }
  }, signal)
  return { linked, unavailable }
}
