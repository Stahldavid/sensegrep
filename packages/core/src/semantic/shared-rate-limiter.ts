import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

type Entry = { at: number; tokens: number }
type State = { version: 1; rpm: number | null; tpm: number | null; windowMs: number; entries: Entry[] }

/** Local-filesystem shared sliding window. Reservations are durable before the
 * caller sends a request. A crashed guard holder blocks until manual recovery. */
export class SharedRateLimiter {
  private readonly directory: string
  constructor(root: string, scope: string, private readonly rpm: number, private readonly tpm: number, private readonly windowMs = 60_000) {
    if (!root || !scope.trim() || !(rpm === Infinity || Number.isSafeInteger(rpm) && rpm >= 1) || !(tpm > 0) || !Number.isFinite(windowMs) || windowMs <= 0) throw new RangeError("Invalid shared quota configuration")
    this.directory = path.join(path.resolve(root), createHash("sha256").update(scope).digest("hex"))
  }

  async acquire(tokens: number, options: { signal?: AbortSignal; deadlineAt?: number } = {}): Promise<void> {
    if (!Number.isFinite(tokens) || tokens < 0) throw new RangeError("Invalid token estimate")
    if (tokens > this.tpm) throw new RangeError("Embedding batch exceeds the token-per-minute capacity; reduce the batch size")
    const deadline = options.deadlineAt ?? Infinity
    if (Number.isNaN(deadline)) throw new RangeError("Invalid rate-limit deadline")
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 })
    const guard = path.join(this.directory, "guard")
    let guardWaitStarted = Date.now()
    for (;;) {
      options.signal?.throwIfAborted()
      if (Date.now() >= deadline) throw new DOMException("Shared rate-limit deadline exceeded", "TimeoutError")
      try { await fs.mkdir(guard, { mode: 0o700 }) }
      catch (error: any) {
        if (error?.code !== "EEXIST") throw error
        if (Date.now() - guardWaitStarted >= 30_000) throw new Error(`Shared quota guard is busy or abandoned at ${guard}; stop all clients before inspecting it`)
        await delay(Math.min(50, deadline - Date.now()), options.signal)
        continue
      }
      guardWaitStarted = Date.now()
      let next = 50
      try {
        options.signal?.throwIfAborted()
        if (Date.now() >= deadline) throw new DOMException("Shared rate-limit deadline exceeded", "TimeoutError")
        const statePath = path.join(this.directory, "window.json")
        let state: State
        try { state = JSON.parse(await fs.readFile(statePath, "utf8")) }
        catch (error: any) {
          if (error?.code !== "ENOENT") throw new Error("Shared quota state is unreadable; verify all clients have stopped before recovery", { cause: error })
          state = { version: 1, rpm: Number.isFinite(this.rpm) ? this.rpm : null, tpm: Number.isFinite(this.tpm) ? this.tpm : null, windowMs: this.windowMs, entries: [] }
        }
        if (state.version !== 1 || state.rpm !== (Number.isFinite(this.rpm) ? this.rpm : null) || state.tpm !== (Number.isFinite(this.tpm) ? this.tpm : null) || state.windowMs !== this.windowMs || !Array.isArray(state.entries) || state.entries.some(e => !Number.isFinite(e?.at) || !Number.isFinite(e?.tokens) || e.tokens < 0)) {
          throw new Error("Shared quota state is invalid or its limits differ; use identical limits for all clients and follow the recovery procedure")
        }
        const now = Date.now()
        // Future timestamps remain charged if the wall clock moves backwards.
        state.entries = state.entries.filter(entry => entry.at + this.windowMs > now)
        const total = state.entries.reduce((sum, entry) => sum + entry.tokens, 0)
        if (state.entries.length < this.rpm && total + tokens <= this.tpm) {
          state.entries.push({ at: now, tokens })
          const temporary = path.join(this.directory, `${randomUUID()}.tmp`)
          try {
            await fs.writeFile(temporary, JSON.stringify(state), { flag: "wx", mode: 0o600 })
            await fs.rename(temporary, statePath)
          } finally { await fs.rm(temporary, { force: true }) }
          // A cancellation or deadline can occur while the filesystem call is
          // in progress. Keep the durable reservation, but do not admit the
          // caller once it has stopped waiting.
          options.signal?.throwIfAborted()
          if (Date.now() >= deadline) throw new DOMException("Shared rate-limit deadline exceeded", "TimeoutError")
          return
        }
        next = Math.max(1, Math.min(...state.entries.map(entry => entry.at + this.windowMs - now)))
      } finally { await fs.rmdir(guard) }
      await delay(Math.min(next, deadline - Date.now()), options.signal)
    }
  }
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const done = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); resolve() }
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal?.reason ?? new DOMException("Cancelled", "AbortError")) }
    const timer = setTimeout(done, Math.max(1, ms))
    signal?.addEventListener("abort", abort, { once: true })
    if (signal?.aborted) abort()
  })
}
