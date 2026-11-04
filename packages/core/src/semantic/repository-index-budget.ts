import fs from "node:fs/promises"
import { constants, type Stats } from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import { Global } from "../global/index.js"
import { sharedRepositoryScope } from "../project/repository-sharing.js"
import { validateRepositoryId } from "./source-manifest.js"
import { withSharedSourceGuard } from "./shared-source-retention.js"

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024
const canonicalKey = (root: string) => process.platform === "win32" ? path.resolve(root).toLowerCase() : path.resolve(root)

export class RepositoryIndexBudgetError extends Error {
  constructor(readonly repositoryId: string, readonly bytes: number, readonly maxBytes: number) {
    super(`Shared repository index budget exceeded (${bytes} > ${maxBytes}); release retained views or increase SENSEGREP_SHARED_INDEX_MAX_BYTES`)
    this.name = "RepositoryIndexBudgetError"
  }
}

function budget(): number {
  const value = process.env.SENSEGREP_SHARED_INDEX_MAX_BYTES === undefined ? DEFAULT_MAX_BYTES : Number(process.env.SENSEGREP_SHARED_INDEX_MAX_BYTES)
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("SENSEGREP_SHARED_INDEX_MAX_BYTES must be a non-negative safe integer")
  return value
}

async function readJson(filename: string, maxBytes: number): Promise<any> {
  const before = await fs.lstat(filename)
  if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes) throw new Error("Unsafe or oversized repository index accounting metadata")
  const handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > maxBytes || stat.dev !== before.dev || stat.ino !== before.ino) throw new Error("Repository index accounting metadata changed while opening")
    const data = Buffer.allocUnsafe(stat.size + 1)
    let offset = 0
    while (offset < data.length) {
      const { bytesRead } = await handle.read(data, offset, data.length - offset, offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    if (offset !== stat.size) throw new Error("Repository index accounting metadata changed while reading")
    return JSON.parse(data.subarray(0, offset).toString("utf8"))
  } finally { await handle.close() }
}

/** Read immutable v1 bindings without requiring the original checkout to exist.
 * Retained index files from removed worktrees still count toward the budget.
 */
async function repositoryRoots(repositoryId: string): Promise<Set<string>> {
  const directory = path.join(Global.Path.data, "repository-bindings")
  const roots = new Set<string>()
  let names: string[]
  try { names = await fs.readdir(directory) }
  catch (error: any) { if (error?.code === "ENOENT") return roots; throw error }
  for (const name of names.filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
    const binding = await readJson(path.join(directory, name), 16 * 1024)
    if (binding?.version !== 1 || typeof binding.root !== "string" || !path.isAbsolute(binding.root) || typeof binding.repositoryId !== "string") throw new Error("Invalid repository binding during index accounting")
    validateRepositoryId(binding.repositoryId)
    const root = canonicalKey(binding.root)
    if (`${createHash("sha256").update(root).digest("hex")}.json` !== name) throw new Error("Repository binding filename mismatch during index accounting")
    if (binding.repositoryId === repositoryId) roots.add(root)
  }
  return roots
}

function allocatedBytes(stat: Stats): number {
  // POSIX st_blocks counts allocated 512-byte units, including sparse files.
  // Windows does not expose a reliable equivalent through Node Stats.
  const bytes = process.platform !== "win32" && Number.isSafeInteger(stat.blocks) && stat.blocks >= 0 ? stat.blocks * 512 : stat.size
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error("Invalid file size during repository index accounting")
  return bytes
}

async function measureTree(directory: string, inodes: Set<string>): Promise<number> {
  let entries: import("node:fs").Dirent[]
  try { entries = await fs.readdir(directory, { withFileTypes: true }) }
  catch (error: any) { if (error?.code === "ENOENT") return 0; throw error }
  let bytes = 0
  for (const entry of entries) {
    const filename = path.join(directory, entry.name)
    let stat: Stats
    try { stat = await fs.lstat(filename) }
    catch (error: any) { if (error?.code === "ENOENT") continue; throw error }
    if (stat.isSymbolicLink()) throw new Error("Symbolic links are not accepted in repository index accounting")
    if (stat.isDirectory()) bytes += await measureTree(filename, inodes)
    else if (stat.isFile()) {
      const key = `${stat.dev}:${stat.ino}`
      if (!inodes.has(key)) { inodes.add(key); bytes += allocatedBytes(stat) }
    } else throw new Error("Unsafe filesystem entry during repository index accounting")
    if (!Number.isSafeInteger(bytes)) throw new Error("Repository index byte count exceeds the safe integer range")
  }
  return bytes
}

async function measureRepository(repositoryId: string, currentIndexDirectory: string): Promise<number> {
  const roots = await repositoryRoots(repositoryId)
  const ownedNames = new Set<string>()
  for (const root of roots) {
    ownedNames.add(`project_${createHash("sha256").update(root).digest("hex").slice(0, 24)}`)
    // Legacy default-profile directories used the same 32-bit path hash as
    // VectorStore.projectDir. Retained data must still count after release.
    let legacy = 0
    for (let index = 0; index < root.length; index++) { legacy = (legacy << 5) - legacy + root.charCodeAt(index); legacy &= legacy }
    ownedNames.add(`project_${Math.abs(legacy).toString(16)}`)
  }
  const base = path.join(Global.Path.data, ".lancedb")
  const indices = new Set<string>([path.resolve(currentIndexDirectory)])
  for (const entry of await fs.readdir(base, { withFileTypes: true }).catch((error: any) => { if (error?.code === "ENOENT") return []; throw error })) {
    if (!entry.name.startsWith("project_")) continue
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("Unsafe project index directory during repository accounting")
    const directory = path.join(base, entry.name)
    const profileSuffix = entry.name.match(/^(project_[a-f0-9]{24})_[a-f0-9]{12}$/)
    if (ownedNames.has(entry.name) || (profileSuffix && ownedNames.has(profileSuffix[1]))) {
      // Binding-derived ownership survives metadata removal, removed worktrees,
      // unpublished staging and retained COW bases referenced by another view.
      indices.add(directory)
      continue
    }
    let meta: any
    try { meta = await readJson(path.join(directory, "index-meta.json"), 64 * 1024 * 1024) }
    catch (error: any) {
      if (error?.code !== "ENOENT") throw error
      try { meta = await readJson(path.join(directory, ".released-view.json"), 64 * 1024) }
      catch (markerError: any) { if (markerError?.code === "ENOENT") continue; throw markerError }
      if (meta?.version !== 1 || meta?.repositoryId !== repositoryId) continue
    }
    if (typeof meta?.root !== "string" || !path.isAbsolute(meta.root)) throw new Error("Invalid index root during repository accounting")
    if (roots.has(canonicalKey(meta.root))) indices.add(directory)
  }
  const inodes = new Set<string>()
  let bytes = 0
  for (const directory of indices) {
    let entries: import("node:fs").Dirent[]
    try { entries = await fs.readdir(directory, { withFileTypes: true }) }
    catch (error: any) { if (error?.code === "ENOENT") continue; throw error }
    for (const entry of entries) {
      if (!entry.name.endsWith(".lance")) continue
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("Unsafe Lance table directory during repository accounting")
      bytes += await measureTree(path.join(directory, entry.name), inodes)
      if (!Number.isSafeInteger(bytes)) throw new Error("Repository index byte count exceeds the safe integer range")
    }
  }
  return bytes
}

/** Serialize accounting and metadata activation for explicitly shared local views.
 * Callers stage table data first, then invoke this with an atomic metadata-only
 * publication callback. This function never deletes data or overrides references.
 */
export async function withRepositoryIndexBudget<T>(root: string, indexDirectory: string, fn: () => Promise<T>): Promise<T> {
  const repositoryId = await sharedRepositoryScope(root)
  if (!repositoryId) return fn()
  const maxBytes = budget()
  const directory = path.join(Global.Path.data, "repository-index-budgets-v1", repositoryId)
  return withSharedSourceGuard(directory, async () => {
    const bytes = await measureRepository(repositoryId, indexDirectory)
    if (bytes > maxBytes) throw new RepositoryIndexBudgetError(repositoryId, bytes, maxBytes)
    return fn()
  })
}
