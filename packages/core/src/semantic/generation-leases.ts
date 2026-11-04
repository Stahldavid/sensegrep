import { randomUUID, createHash } from "node:crypto"
import { mkdir, open, readFile, readlink, readdir, rmdir, unlink } from "node:fs/promises"
import path from "node:path"

/**
 * Cross-process, fail-closed reader/collector coordination for a generation.
 * Coordination state must be on the same local filesystem for every process
 * using an index. A crashed guard and unverifiable reader are never guessed dead.
 */
async function pidScope(): Promise<string | undefined> {
  if (process.platform !== "linux") return undefined
  try {
    const [namespace, boot] = await Promise.all([
      readlink("/proc/self/ns/pid"), readFile("/proc/sys/kernel/random/boot_id", "utf8"),
    ])
    return `${boot.trim()}:${namespace}`
  } catch { return undefined }
}

async function definitelyDeadReader(file: string, scope: string | undefined): Promise<boolean> {
  if (!scope) return false
  try {
    const owner: unknown = JSON.parse(await readFile(file, "utf8"))
    if (!owner || typeof owner !== "object") return false
    const { version, pid, pidScope: ownerScope } = owner as Record<string, unknown>
    if (version !== 1 || ownerScope !== scope || !Number.isSafeInteger(pid) || (pid as number) <= 0) return false
    try { process.kill(pid as number, 0); return false }
    catch (error: any) { return error?.code === "ESRCH" }
  } catch { return false }
}
export class GenerationUnavailableError extends Error {
  constructor(generation: string) {
    super(`Index generation ${generation} is being collected or has been collected; retry the query against the current index.`)
    this.name = "GenerationUnavailableError"
  }
}

export class GenerationLeases {
  private readonly directory: string
  constructor(indexDirectory: string, private readonly generation: string) {
    const key = createHash("sha256").update(generation).digest("hex")
    this.directory = path.join(indexDirectory, ".generation-leases", key)
  }

  private async guard<T>(fn: () => Promise<T>, signal?: AbortSignal, timeoutMs = 10_000): Promise<T> {
    await mkdir(this.directory, { recursive: true })
    const guardPath = path.join(this.directory, "guard")
    const deadline = Date.now() + timeoutMs
    for (;;) {
      signal?.throwIfAborted()
      try {
        await mkdir(guardPath)
        break
      } catch (error: any) {
        if (error?.code !== "EEXIST") throw error
        if (Date.now() >= deadline) throw new Error(`Timed out acquiring generation guard ${guardPath}; verify all index users have stopped before manual recovery.`)
        await new Promise<void>((resolve, reject) => {
          const finish = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); resolve() }
          const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal?.reason ?? new Error("Cancelled")) }
          const timer = setTimeout(finish, Math.min(25, Math.max(1, deadline - Date.now())))
          signal?.addEventListener("abort", abort, { once: true })
          if (signal?.aborted) abort()
        })
      }
    }
    try { return await fn() } finally { await rmdir(guardPath) }
  }

  /** Acquire before opening the named table; release in a finally block. */
  async acquire(signal?: AbortSignal): Promise<() => Promise<void>> {
    const lease = path.join(this.directory, `reader-${randomUUID()}`)
    const scope = await pidScope()
    await this.guard(async () => {
      const entries = await readdir(this.directory)
      if (entries.includes("tombstone")) throw new GenerationUnavailableError(this.generation)
      const handle = await open(lease, "wx")
      try { await handle.writeFile(JSON.stringify({ version: 1, pid: process.pid, pidScope: scope })) }
      finally { await handle.close() }
    }, signal)
    let released = false
    return async () => {
      if (released) return
      // Removal may be retried after a filesystem failure.
      await unlink(lease)
      released = true
    }
  }

  /** Returns false while any reader is present; tombstones persist after deletion. */
  async collect(removeGeneration: () => Promise<void>, signal?: AbortSignal): Promise<boolean> {
    const scope = await pidScope()
    return this.guard(async () => {
      const entries = await readdir(this.directory)
      for (const entry of entries.filter(entry => entry.startsWith("reader-"))) {
        const file = path.join(this.directory, entry)
        if (await definitelyDeadReader(file, scope)) {
          // Acquisition and stale recovery are serialized by the guard. A
          // normal release may concurrently unlink this exact unique file.
          await unlink(file).catch((error: any) => { if (error?.code !== "ENOENT") throw error })
        } else {
          // An empty legacy lease, another namespace, EPERM or PID reuse is
          // not evidence of death. A concurrent release is safe to retry.
          return false
        }
      }
      if (entries.includes("collected")) return true
      if (!entries.includes("tombstone")) {
        const handle = await open(path.join(this.directory, "tombstone"), "wx")
        await handle.close()
      }
      // Guard remains held through deletion: other collectors cannot race it.
      await removeGeneration()
      // If the process crashes between deletion and this marker, a retry may
      // repeat removeGeneration; callers must make that operation idempotent.
      const completed = await open(path.join(this.directory, "collected"), "wx")
      await completed.close()
      return true
    }, signal)
  }
}
