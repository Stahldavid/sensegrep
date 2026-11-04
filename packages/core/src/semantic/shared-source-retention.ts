import fs from "node:fs/promises"
import path from "node:path"

export type SharedSourceBudget = { maxBytes?: number; maxAgeMs?: number; signal?: AbortSignal }
const HASH = /^[a-f0-9]{64}$/
function limit(value: number | undefined, env: string, fallback: number): number {
  const selected = value ?? (process.env[env] === undefined ? fallback : Number(process.env[env]))
  if (!Number.isSafeInteger(selected) || selected < 0) throw new RangeError(`Invalid ${env}`)
  return selected
}

/** All shared publication/link and collection operations must use this guard. */
export async function withSharedSourceGuard<T>(directory: string, fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  const guard = path.join(directory, ".retention-guard")
  const deadline = Date.now() + 30_000
  for (;;) {
    signal?.throwIfAborted()
    try { await fs.mkdir(guard); break }
    catch (error: any) {
      if (error?.code !== "EEXIST") throw error
      if (Date.now() >= deadline) throw new Error(`Shared source retention guard is busy or abandoned at ${guard}; stop all users before recovery`)
      await new Promise<void>((resolve, reject) => {
        const done = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); resolve() }
        const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal?.reason ?? new Error("Cancelled")) }
        const timer = setTimeout(done, 25)
        signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort()
      })
    }
  }
  try { return await fn() } finally { await fs.rmdir(guard) }
}

/** Caller holds withSharedSourceGuard. Local CAS hardlinks are persistent pins.
 * Only unlinked shared cache entries may be evicted. Capacity never evicts pins. */
export async function admitSharedSource(directory: string, sha256: string, incomingBytes: number, options: SharedSourceBudget = {}): Promise<{ removed: number; bytes: number }> {
  if (!HASH.test(sha256) || !Number.isSafeInteger(incomingBytes) || incomingBytes < 0) throw new RangeError("Invalid shared source admission")
  const maxBytes = limit(options.maxBytes, "SENSEGREP_SHARED_SOURCE_MAX_BYTES", 512 * 1024 * 1024)
  const maxAgeMs = limit(options.maxAgeMs, "SENSEGREP_SHARED_SOURCE_MAX_AGE_MS", 7 * 24 * 60 * 60_000)
  const now = Date.now()
  const entries = []
  for (const name of await fs.readdir(directory)) {
    // The same guard covers publishers. Any temporary name left here belongs
    // to a completed or interrupted publication; unlinking its extra name
    // cannot remove a final object or another checkout's hardlink.
    if (/^[a-f0-9]{64}\.[a-f0-9-]{36}\.tmp$/.test(name)) {
      const temporary = path.join(directory, name)
      const stat = await fs.lstat(temporary)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Unsafe shared source temporary entry")
      await fs.unlink(temporary)
      continue
    }
    if (!HASH.test(name)) continue
    const stat = await fs.lstat(path.join(directory, name))
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Unsafe shared source entry")
    entries.push({ name, size: stat.size, nlink: stat.nlink, mtimeMs: stat.mtimeMs })
  }
  const existing = entries.find(entry => entry.name === sha256)
  if (existing && existing.size !== incomingBytes) throw new Error("Shared source size mismatch")
  let bytes = entries.reduce((sum, entry) => sum + entry.size, 0)
  const required = existing ? 0 : incomingBytes
  let removed = 0
  for (const entry of entries.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    options.signal?.throwIfAborted()
    if (entry.name === sha256 || entry.nlink !== 1 || (now - entry.mtimeMs <= maxAgeMs && bytes + required <= maxBytes)) continue
    await fs.unlink(path.join(directory, entry.name))
    bytes -= entry.size; removed++
  }
  if (bytes + required > maxBytes) throw new Error(`Shared source budget exceeded (${bytes + required} > ${maxBytes}); retained index references must be released before adding source objects`)
  options.signal?.throwIfAborted()
  return { removed, bytes: bytes + required }
}
