import fs from "node:fs/promises"
import path from "node:path"
import { CliUsageError } from "./cli-errors.js"
import { writeJson } from "./output.js"
import { cliProfile } from "./cli-profile.js"
import type { Flags } from "./search-commands.js"

type Bundle = { snapshotId: string; manifest: { repositoryId: string; universe: string; files: unknown[] } }
type SnapshotCore = {
  Instance: { provide<T>(options: { directory: string; profile?: string; fn: () => Promise<T> }): Promise<T> }
  captureIndexedSourceBundle(root: string): Promise<Bundle>
  serveSourceBundle(bundle: Bundle, secret: string): Promise<{ port: number }>
  fetchSourceBundle(port: number, secret: string, expected: { repositoryId: string; snapshotId: string }, signal?: AbortSignal, replicaDirectory?: string): Promise<Bundle>
  storeSourceBundle(directory: string, input: Bundle, expected: { repositoryId: string; snapshotId: string }): Promise<string>
  readStoredSourceBundle(filename: string, expected: { repositoryId: string; snapshotId: string }): Promise<Bundle>
  decodeResultId(resultId: string): { repositoryId?: string; snapshotId?: string; sourceHash?: string }
  createPortableResultId(bundle: Bundle, location: { file: string; startLine: number; endLine: number }): string
  readPortableResult(bundle: Bundle, resultId: string, expectedRepositoryId: string): { location: unknown; content: string }
  pinReplicaSnapshot(directory: string, snapshotId: string): Promise<void>
  unpinReplicaSnapshot(directory: string, snapshotId: string): Promise<void>
  collectReplicaObjects(directory: string, options?: { maxBytes?: number; retainSnapshots?: number }): Promise<{ removedSnapshots: number; removedObjects: number; bytes: number }>
}

const repositoryPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const snapshotPattern = /^sha256:[0-9a-f]{64}$/

function secretFromEnvironment(): string {
  const secret = process.env.SENSEGREP_SNAPSHOT_TOKEN
  if (!secret || Buffer.byteLength(secret) < 32 || Buffer.byteLength(secret) > 512 || !/^[\x21-\x7e]+$/.test(secret)) {
    throw new CliUsageError("Set SENSEGREP_SNAPSHOT_TOKEN to a 32–512 byte token of printable non-space ASCII characters")
  }
  return secret
}

async function readReplicaJson(filename: string): Promise<any> {
  const before = await fs.lstat(filename)
  if (!before.isFile() || before.isSymbolicLink() || before.size > 4 * 1024 * 1024) throw new CliUsageError("Invalid replica identity file")
  const handle = await fs.open(filename, "r")
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size !== before.size || stat.dev !== before.dev || stat.ino !== before.ino) throw new CliUsageError("Replica identity file changed while opening")
    const data = Buffer.allocUnsafe(stat.size + 1)
    let offset = 0
    while (offset < data.length) {
      const { bytesRead } = await handle.read(data, offset, data.length - offset, offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    if (offset !== stat.size) throw new CliUsageError("Replica identity file changed while reading")
    return JSON.parse(data.subarray(0, offset).toString("utf8"))
  } finally { await handle.close() }
}

function replicaNumber(flags: Flags, name: string): number | undefined {
  if (flags[name] === undefined) return undefined
  const value = typeof flags[name] === "string" && /^\d+$/.test(flags[name]) ? Number(flags[name]) : NaN
  if (!Number.isSafeInteger(value) || value < 0) throw new CliUsageError(`--${name} must be a non-negative integer`)
  return value
}

export async function snapshotCommand(core: SnapshotCore, root: string, flags: Flags, positional: string[]): Promise<void> {
  const [action, ...extra] = positional
  if (extra.length || !["serve", "fetch", "show", "reference", "pin", "unpin", "gc"].includes(action)) throw new CliUsageError("snapshot requires serve, fetch, show, reference, pin, unpin, or gc")
  if (action === "gc") {
    const allowed = new Set(["destination", "repository", "max-bytes", "retain-snapshots", "json", "pretty"])
    if (Object.keys(flags).some(flag => !allowed.has(flag))) throw new CliUsageError("Invalid option for snapshot gc")
    const directory = typeof flags.destination === "string" ? flags.destination : ""
    const repositoryId = typeof flags.repository === "string" ? flags.repository : ""
    if (!directory.trim() || !repositoryPattern.test(repositoryId)) throw new CliUsageError("snapshot gc requires --destination <dir> --repository <lowercase-uuid>")
    const resolved = await fs.realpath(path.resolve(directory))
    const binding = await readReplicaJson(path.join(resolved, ".replica-repository.json"))
    if (binding?.version !== 1 || binding.repositoryId !== repositoryId) throw new Error("Replica repository identity mismatch")
    const options = { maxBytes: replicaNumber(flags, "max-bytes"), retainSnapshots: replicaNumber(flags, "retain-snapshots") }
    if (options.retainSnapshots === 0) throw new CliUsageError("--retain-snapshots must be at least 1")
    const result = await core.collectReplicaObjects(resolved, options)
    writeJson({ schemaVersion: 1, command: "snapshot gc", status: "collected", repositoryId, destination: resolved, ...result })
    return
  }
  if (action === "pin" || action === "unpin") {
    const allowed = new Set(["artifact", "repository", "snapshot", "json", "pretty"])
    if (Object.keys(flags).some(flag => !allowed.has(flag))) throw new CliUsageError(`Invalid option for snapshot ${action}`)
    const artifact = typeof flags.artifact === "string" ? flags.artifact : ""
    const repositoryId = typeof flags.repository === "string" ? flags.repository : ""
    const snapshotId = typeof flags.snapshot === "string" ? flags.snapshot : ""
    if (!artifact.trim() || !repositoryPattern.test(repositoryId) || !snapshotPattern.test(snapshotId)) throw new CliUsageError(`snapshot ${action} requires --artifact <file> --repository <lowercase-uuid> --snapshot <sha256:id>`)
    const filename = path.resolve(artifact)
    const descriptor = await readReplicaJson(filename)
    if (descriptor?.storage !== "source-replica-v1" || descriptor.snapshotId !== snapshotId || descriptor.manifest?.repositoryId !== repositoryId || path.basename(filename) !== `${snapshotId.slice(7)}.json`) throw new Error("Replica artifact identity mismatch")
    await core.readStoredSourceBundle(filename, { repositoryId, snapshotId })
    const directory = path.dirname(filename)
    if (action === "pin") await core.pinReplicaSnapshot(directory, snapshotId)
    else await core.unpinReplicaSnapshot(directory, snapshotId)
    writeJson({ schemaVersion: 1, command: `snapshot ${action}`, status: action === "pin" ? "pinned" : "unpinned", repositoryId, snapshotId, artifact: filename })
    return
  }
  if (action === "show" || action === "reference") {
    const allowed = new Set(action === "show" ? ["artifact", "repository", "result", "json", "pretty"] : ["artifact", "repository", "snapshot", "file", "start", "end", "json", "pretty"])
    if (Object.keys(flags).some(flag => !allowed.has(flag))) throw new CliUsageError(`Invalid option for snapshot ${action}`)
    const artifact = typeof flags.artifact === "string" ? flags.artifact : ""
    const repositoryId = typeof flags.repository === "string" ? flags.repository : ""
    if (!artifact.trim() || !repositoryPattern.test(repositoryId)) throw new CliUsageError(`snapshot ${action} requires --artifact <file> --repository <lowercase-uuid>`)
    if (action === "show") {
      const resultId = typeof flags.result === "string" ? flags.result : ""
      if (!resultId) throw new CliUsageError("snapshot show requires --result <portable-result-id>")
      const location = core.decodeResultId(resultId)
      if (location.repositoryId !== repositoryId || !location.snapshotId || !snapshotPattern.test(location.snapshotId) || !location.sourceHash) throw new Error("Portable reference identity is missing or incompatible")
      const bundle = await core.readStoredSourceBundle(path.resolve(artifact), { repositoryId, snapshotId: location.snapshotId })
      const result = core.readPortableResult(bundle, resultId, repositoryId)
      writeJson({ schemaVersion: 1, command: "snapshot show", status: "available", repositoryId, snapshotId: location.snapshotId, ...result, source: "immutable-indexed-file-bundle" })
      return
    }
    const snapshotId = typeof flags.snapshot === "string" ? flags.snapshot : ""
    const file = typeof flags.file === "string" ? flags.file : ""
    const start = typeof flags.start === "string" && /^\d+$/.test(flags.start) ? Number(flags.start) : NaN
    const end = typeof flags.end === "string" && /^\d+$/.test(flags.end) ? Number(flags.end) : NaN
    if (!snapshotPattern.test(snapshotId) || !file || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
      throw new CliUsageError("snapshot reference requires --snapshot <sha256:id> --file <relative-path> --start <line> --end <line>")
    }
    const bundle = await core.readStoredSourceBundle(path.resolve(artifact), { repositoryId, snapshotId })
    const resultId = core.createPortableResultId(bundle, { file, startLine: start, endLine: end })
    writeJson({ schemaVersion: 1, command: "snapshot reference", status: "created", repositoryId, snapshotId, resultId,
      note: "This is a source location, not evidence of a symbol or search result." })
    return
  }
  const secret = secretFromEnvironment()
  if (action === "serve") {
    if (Object.keys(flags).some(flag => !["root", "profile", "json", "pretty"].includes(flag))) throw new CliUsageError("snapshot serve accepts only --root and --profile")
    const canonical = await fs.realpath(root)
    const profile = cliProfile(typeof flags.profile === "string" ? flags.profile : undefined)
    const bundle = await core.Instance.provide({ directory: canonical, profile, fn: () => core.captureIndexedSourceBundle(canonical) })
    const { port } = await core.serveSourceBundle(bundle, secret)
    writeJson({ schemaVersion: 1, command: "snapshot serve", status: "listening", host: "127.0.0.1", port, root: canonical,
      profile, repositoryId: bundle.manifest.repositoryId, snapshotId: bundle.snapshotId,
      universe: bundle.manifest.universe, files: bundle.manifest.files.length })
    return
  }
  if (Object.keys(flags).some(flag => !["port", "repository", "snapshot", "destination", "json", "pretty"].includes(flag))) throw new CliUsageError("Invalid option for snapshot fetch")
  const portText = typeof flags.port === "string" ? flags.port : ""
  const port = /^\d+$/.test(portText) ? Number(portText) : NaN
  const repositoryId = typeof flags.repository === "string" ? flags.repository : ""
  const snapshotId = typeof flags.snapshot === "string" ? flags.snapshot : ""
  const directory = typeof flags.destination === "string" ? flags.destination : ""
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535 || !repositoryPattern.test(repositoryId)
      || !snapshotPattern.test(snapshotId) || !directory.trim()) {
    throw new CliUsageError("snapshot fetch requires --port <1-65535> --repository <lowercase-uuid> --snapshot <sha256:id> --destination <dir>")
  }
  const expected = { repositoryId, snapshotId }
  const bundle = await core.fetchSourceBundle(port, secret, expected, undefined, path.resolve(directory))
  const artifact = await core.storeSourceBundle(path.resolve(directory), bundle, expected)
  writeJson({ schemaVersion: 1, command: "snapshot fetch", status: "stored", repositoryId, snapshotId, artifact,
    universe: bundle.manifest.universe, files: bundle.manifest.files.length, indexActivated: false })
}
