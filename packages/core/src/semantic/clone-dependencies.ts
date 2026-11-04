import { AsyncLocalStorage } from "node:async_hooks"
import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import { constants } from "node:fs"
import path from "node:path"
import { Global } from "../global/index.js"

export type CloneAddress = { directory: string; table: string }
export type CloneDependency = { source: CloneAddress; target: CloneAddress }
type Registry = { version: 1; dependencies: CloneDependency[] }
type GuardOptions = { directory?: string; signal?: AbortSignal; timeoutMs?: number }
const active = new AsyncLocalStorage<{ directory: string }>()
const MAX_STATE_BYTES = 32 * 1024 * 1024
const MAX_DEPENDENCIES = 100_000

export class CloneCoordinationError extends Error {
  constructor(message: string) { super(message); this.name = "CloneCoordinationError" }
}

function key(address: CloneAddress): string { return JSON.stringify([address.directory, address.table]) }
function validAddress(value: unknown): value is CloneAddress {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const address = value as CloneAddress
  return Object.keys(value).sort().join(",") === "directory,table" && typeof address.directory === "string" && path.isAbsolute(address.directory) && !address.directory.includes("\0") && typeof address.table === "string" && /^[A-Za-z_][A-Za-z0-9_.-]{0,255}$/.test(address.table)
}
async function canonical(address: CloneAddress): Promise<CloneAddress> {
  if (!validAddress({ directory: path.resolve(address.directory), table: address.table })) throw new CloneCoordinationError("Invalid clone table address")
  const directory = await fs.realpath(address.directory)
  if (!(await fs.stat(directory)).isDirectory()) throw new CloneCoordinationError("Clone database location must be a directory")
  return { directory: process.platform === "win32" ? directory.toLowerCase() : directory, table: address.table }
}
function context(): { directory: string } {
  const value = active.getStore()
  if (!value) throw new CloneCoordinationError("Clone registry operation requires the clone coordination guard")
  return value
}
async function readBounded(filename: string): Promise<string> {
  const stat = await fs.lstat(filename)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_STATE_BYTES) throw new CloneCoordinationError("Unsafe or oversized clone coordination state")
  const handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || opened.size > MAX_STATE_BYTES) throw new CloneCoordinationError("Unsafe or oversized clone coordination state")
    const buffer = Buffer.allocUnsafe(opened.size + 1)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    if (offset !== opened.size) throw new CloneCoordinationError("Clone coordination state changed while reading")
    return buffer.subarray(0, offset).toString("utf8")
  } finally { await handle.close() }
}
function validateRegistry(value: unknown): Registry {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CloneCoordinationError("Invalid clone coordination state")
  const registry = value as Registry
  if (Object.keys(value).sort().join(",") !== "dependencies,version" || registry.version !== 1 || !Array.isArray(registry.dependencies) || registry.dependencies.length > MAX_DEPENDENCIES) throw new CloneCoordinationError("Invalid clone coordination state")
  const targets = new Set<string>()
  for (const entry of registry.dependencies) {
    if (!entry || Object.keys(entry).sort().join(",") !== "source,target" || !validAddress(entry.source) || !validAddress(entry.target) || key(entry.source) === key(entry.target) || targets.has(key(entry.target))) throw new CloneCoordinationError("Invalid clone dependency")
    targets.add(key(entry.target))
  }
  // Linear traversal: constructing/traversing the graph once avoids quadratic
  // validation as retained worktree generations accumulate.
  const parents = new Map(registry.dependencies.map(entry => [key(entry.target), key(entry.source)]))
  const checked = new Set<string>()
  for (const start of parents.keys()) {
    const chain = new Set<string>()
    let current: string | undefined = start
    while (current !== undefined && !checked.has(current)) {
      if (chain.has(current)) throw new CloneCoordinationError("Clone dependency cycle")
      chain.add(current)
      current = parents.get(current)
    }
    for (const item of chain) checked.add(item)
  }
  return registry
}
function depthInRegistry(registry: Registry, address: CloneAddress): number {
  const parents = new Map(registry.dependencies.map(entry => [key(entry.target), entry.source]))
  const seen = new Set<string>()
  let current = address, depth = 0
  for (;;) {
    const identity = key(current)
    if (seen.has(identity)) throw new CloneCoordinationError("Clone dependency cycle")
    seen.add(identity)
    const parent = parents.get(identity)
    if (!parent) return depth
    current = parent; depth++
  }
}
async function load(): Promise<Registry> {
  const { directory } = context()
  let text: string
  try { text = await readBounded(path.join(directory, "dependencies.json")) }
  catch (error: any) {
    if (error?.code !== "ENOENT") throw error
    // Once initialized, a missing registry is not evidence that dependencies vanished.
    try { await fs.lstat(path.join(directory, "initialized")) }
    catch (markerError: any) { if (markerError?.code === "ENOENT") return { version: 1, dependencies: [] }; throw markerError }
    throw new CloneCoordinationError("Clone dependency registry is missing; restore it before collecting any managed tables")
  }
  const registry = validateRegistry(JSON.parse(text))
  // A process may have died after publishing the initial registry but before
  // its marker. Repair that window before allowing any native clone operation.
  await ensureMarker(directory)
  return registry
}
async function ensureMarker(directory: string): Promise<void> {
  try {
    const marker = await fs.open(path.join(directory, "initialized"), "wx", 0o600)
    try { await marker.writeFile("clone-coordination-v1\n"); await marker.sync() } finally { await marker.close() }
    if (process.platform !== "win32") { const dir = await fs.open(directory, "r"); try { await dir.sync() } finally { await dir.close() } }
  } catch (error: any) { if (error?.code !== "EEXIST") throw error }
}
async function save(registry: Registry): Promise<void> {
  validateRegistry(registry)
  const { directory } = context()
  const data = JSON.stringify(registry)
  if (Buffer.byteLength(data) > MAX_STATE_BYTES) throw new CloneCoordinationError("Clone coordination state exceeds the byte limit")
  const temporary = path.join(directory, `.dependencies-${randomUUID()}.tmp`)
  try {
    const handle = await fs.open(temporary, "wx", 0o600)
    try { await handle.writeFile(data); await handle.sync() } finally { await handle.close() }
    await fs.rename(temporary, path.join(directory, "dependencies.json"))
    await ensureMarker(directory)
    // Directory fsync is available on local POSIX filesystems. Windows does not
    // provide the same guarantee through Node's directory handles.
    if (process.platform !== "win32") { const dir = await fs.open(directory, "r"); try { await dir.sync() } finally { await dir.close() } }
  } finally { await fs.unlink(temporary).catch((error: any) => { if (error?.code !== "ENOENT") throw error }) }
}

/** One local guard covers clone publication, dependency changes and table deletion.
 * A crashed holder leaves the guard: recovery requires verifying every participant
 * has stopped. Different state directories and old/unmanaged clients do not coordinate. */
export async function withCloneGuard<T>(fn: () => Promise<T>, options: GuardOptions = {}): Promise<T> {
  const directory = path.resolve(options.directory ?? path.join(Global.Path.data, "clone-coordination-v1"))
  const inherited = active.getStore()
  if (inherited) {
    if (inherited.directory !== directory) throw new CloneCoordinationError("Cannot nest different clone coordination scopes")
    options.signal?.throwIfAborted()
    return fn()
  }
  const timeoutMs = options.timeoutMs ?? 30_000
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError("Invalid clone guard timeout")
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  const guard = path.join(directory, "guard")
  const deadline = Date.now() + timeoutMs
  for (;;) {
    options.signal?.throwIfAborted()
    try { await fs.mkdir(guard, { mode: 0o700 }); break }
    catch (error: any) {
      if (error?.code !== "EEXIST") throw error
      if (Date.now() >= deadline) throw new CloneCoordinationError(`Clone coordination is busy or abandoned at ${guard}; verify all index users have stopped before recovery`)
      await new Promise<void>((resolve, reject) => {
        const finish = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); resolve() }
        const abort = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); reject(options.signal?.reason ?? new Error("Cancelled")) }
        const timer = setTimeout(finish, Math.min(25, Math.max(1, deadline - Date.now())))
        options.signal?.addEventListener("abort", abort, { once: true })
        if (options.signal?.aborted) abort()
      })
    }
  }
  try {
    options.signal?.throwIfAborted()
    return await active.run({ directory }, fn)
  } finally { await fs.rmdir(guard) }
}

export async function findCloneDependents(source: CloneAddress): Promise<CloneAddress[]> {
  const normalized = await canonical(source)
  return (await load()).dependencies.filter(entry => key(entry.source) === key(normalized)).map(entry => ({ ...entry.target }))
}
export async function cloneDependencyDepth(target: CloneAddress): Promise<number> {
  return depthInRegistry(await load(), await canonical(target))
}
/** Record BEFORE native clone; an interrupted clone retains a conservative pin. */
export async function recordCloneDependency(source: CloneAddress, target: CloneAddress): Promise<void> {
  const entry = { source: await canonical(source), target: await canonical(target) }
  const registry = await load()
  const existing = registry.dependencies.find(value => key(value.target) === key(entry.target))
  if (existing) {
    if (key(existing.source) !== key(entry.source)) throw new CloneCoordinationError("Clone target already has a different parent")
    return
  }
  registry.dependencies.push(entry)
  await save(registry)
}
/** Remove only after successful target deletion, and never while children depend on it. */
export async function removeCloneDependency(target: CloneAddress): Promise<void> {
  const normalized = await canonical(target)
  const registry = await load()
  if (registry.dependencies.some(entry => key(entry.source) === key(normalized))) throw new CloneCoordinationError("Cannot release a clone dependency while descendants remain")
  const next = registry.dependencies.filter(entry => key(entry.target) !== key(normalized))
  if (next.length !== registry.dependencies.length) await save({ version: 1, dependencies: next })
}
