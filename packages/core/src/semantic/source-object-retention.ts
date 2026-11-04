import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { withSharedSourceGuard } from "./shared-source-retention.js"

const HASH = /^[a-f0-9]{64}$/
const root = (indexDirectory: string) => path.join(indexDirectory, ".source-retention")
const referenceName = (generation: string) => `${createHash("sha256").update(generation).digest("hex")}.json`
type Files = Record<string, { sourceSha256?: string; sourceHashKind?: string }>
type Reference = { version: 1; generation: string; complete: boolean; hashes: string[] }

/** Pin publication or multi-object reads before accessing source objects.
 * A crashed pin deliberately prevents collection until an operator verifies exclusion. */
export async function withSourceRetentionPin<T>(indexDirectory: string, fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const directory = root(indexDirectory)
  const pin = path.join(directory, `pin-${randomUUID()}`)
  await withSharedSourceGuard(directory, async () => {
    const handle = await fs.open(pin, "wx", 0o600)
    try { await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: Date.now() })) } finally { await handle.close() }
  }, signal)
  try { return await fn() } finally { await fs.unlink(pin) }
}

/** Publish before activating metadata. Generation names must be immutable. */
export async function writeGenerationSourceRefs(indexDirectory: string, generation: string, files: Files): Promise<void> {
  if (!generation) throw new Error("Source generation identity is required")
  const stats = Object.values(files)
  const complete = stats.every(file => file.sourceHashKind === "sha256-raw-v1" && typeof file.sourceSha256 === "string" && HASH.test(file.sourceSha256))
  const reference: Reference = { version: 1, generation, complete, hashes: [...new Set(stats.flatMap(file => file.sourceHashKind === "sha256-raw-v1" && typeof file.sourceSha256 === "string" && HASH.test(file.sourceSha256) ? [file.sourceSha256] : []))].sort() }
  const directory = root(indexDirectory)
  await withSharedSourceGuard(directory, async () => {
    const target = path.join(directory, referenceName(generation))
    const data = JSON.stringify(reference)
    const temporary = `${target}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(temporary, data, { flag: "wx", mode: 0o600 })
      try { await fs.link(temporary, target) }
      catch (error: any) {
        if (error?.code !== "EEXIST") throw error
        if (await fs.readFile(target, "utf8") !== data) throw new Error("Source reference changed within an immutable generation")
      }
    } finally { await fs.unlink(temporary).catch(() => {}) }
  })
}

/** Remove only after the generation has been dropped under its reader leases. */
export async function removeGenerationSourceRefs(indexDirectory: string, generation: string): Promise<void> {
  const directory = root(indexDirectory)
  await withSharedSourceGuard(directory, () => fs.rm(path.join(directory, referenceName(generation)), { force: true }))
}

export type SourceCollectionOptions = {
  /** Complete set of physical generations still retained. Missing legacy references block GC. */
  generationIds?: string[]
  maxUnreferencedBytes?: number
  maxAgeMs?: number
  signal?: AbortSignal
}
export type SourceCollectionResult = { removed: number; reclaimedBytes: number; remainingBytes: number; skipped?: "active-pin" | "unknown-generations" | "incomplete-reference" }

/** Collect local hardlink names, retaining every referenced or explicitly pinned object.
 * Unlinking a local name never deletes bytes still referenced by another checkout. */
export async function collectSourceObjects(indexDirectory: string, options: SourceCollectionOptions = {}): Promise<SourceCollectionResult> {
  const maxBytes = options.maxUnreferencedBytes ?? 0
  const maxAgeMs = options.maxAgeMs ?? 24 * 60 * 60_000
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || !Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0) throw new RangeError("Invalid source retention budget")
  const directory = root(indexDirectory)
  return withSharedSourceGuard(directory, async () => {
    const none = { removed: 0, reclaimedBytes: 0, remainingBytes: 0 }
    const names = await fs.readdir(directory)
    if (names.some(name => name.startsWith("pin-"))) return { ...none, skipped: "active-pin" }
    if (!options.generationIds) return { ...none, skipped: "unknown-generations" }
    const references = new Map<string, Reference>()
    for (const name of names.filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
      const file = path.join(directory, name)
      const stat = await fs.lstat(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) throw new Error("Unsafe source reference")
      const reference = JSON.parse(await fs.readFile(file, "utf8")) as Reference
      if (reference.version !== 1 || typeof reference.generation !== "string" || typeof reference.complete !== "boolean" || !Array.isArray(reference.hashes) || reference.hashes.some(hash => typeof hash !== "string" || !HASH.test(hash)) || referenceName(reference.generation) !== name) throw new Error("Invalid source reference")
      references.set(reference.generation, reference)
    }
    if (options.generationIds.some(generation => !references.has(generation))) return { ...none, skipped: "unknown-generations" }
    if ([...references.values()].some(reference => !reference.complete)) return { ...none, skipped: "incomplete-reference" }
    const retained = new Set([...references.values()].flatMap(reference => reference.hashes))
    const objects = path.join(indexDirectory, ".source-objects", "sha256")
    let entries: string[]
    try { entries = await fs.readdir(objects) } catch (error: any) { if (error?.code === "ENOENT") return none; throw error }
    const candidates = []
    let remainingBytes = 0, unreferencedBytes = 0
    for (const name of entries.filter(name => HASH.test(name))) {
      const stat = await fs.lstat(path.join(objects, name))
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Unsafe source object")
      remainingBytes += stat.size
      if (!retained.has(name)) { unreferencedBytes += stat.size; candidates.push({ name, size: stat.size, time: stat.mtimeMs }) }
    }
    let removed = 0, reclaimedBytes = 0
    for (const entry of candidates.sort((a, b) => a.time - b.time)) {
      options.signal?.throwIfAborted()
      if (Date.now() - entry.time <= maxAgeMs && unreferencedBytes <= maxBytes) continue
      await fs.unlink(path.join(objects, entry.name))
      removed++; reclaimedBytes += entry.size; remainingBytes -= entry.size; unreferencedBytes -= entry.size
    }
    return { removed, reclaimedBytes, remainingBytes }
  }, options.signal)
}
