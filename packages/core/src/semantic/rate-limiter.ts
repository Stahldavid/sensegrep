import { createHash } from "node:crypto"
import { SharedRateLimiter } from "./shared-rate-limiter.js"

type Pending = {
  tokens: number; deadlineAt: number; signal?: AbortSignal;
  resolve: () => void; reject: (error: Error) => void; onAbort?: () => void
}

/** FIFO sliding window. Queue time is part of the caller deadline. Requests
 * larger than an entire token window cannot succeed and are rejected immediately. */
export class RateLimiter {
  private used: Array<{ at: number; tokens: number }> = []
  private queue: Pending[] = []
  private timer?: ReturnType<typeof setTimeout>
  rpm: number
  tpm: number
  private readonly windowMs: number

  constructor(rpm: number, tpm: number, windowMs = 60_000) {
    if (!(rpm === Infinity || Number.isSafeInteger(rpm) && rpm >= 1) || !(tpm > 0) || !Number.isFinite(windowMs) || windowMs <= 0) throw new RangeError("Invalid rate limits")
    this.rpm = rpm; this.tpm = tpm; this.windowMs = windowMs
  }

  get idle(): boolean { return this.queue.length === 0 && this.used.every(e => e.at + this.windowMs <= Date.now()) }

  constrain(rpm: number, tpm: number): void {
    if (!(rpm === Infinity || Number.isSafeInteger(rpm) && rpm >= 1) || !(tpm > 0)) throw new RangeError("Invalid rate limits")
    this.rpm = Math.min(this.rpm, rpm)
    this.tpm = Math.min(this.tpm, tpm)
    this.pump()
  }

  acquire(tokens: number, options: { signal?: AbortSignal; deadlineAt?: number } = {}): Promise<void> {
    options.signal?.throwIfAborted()
    if (!Number.isFinite(tokens) || tokens < 0) return Promise.reject(new RangeError("Invalid token estimate"))
    if (tokens > this.tpm) return Promise.reject(new RangeError("Embedding batch exceeds the token-per-minute capacity; reduce the batch size"))
    const deadlineAt = options.deadlineAt ?? Infinity
    if (Number.isNaN(deadlineAt)) return Promise.reject(new RangeError("Invalid rate-limit deadline"))
    return new Promise<void>((resolve, reject) => {
      const entry: Pending = { tokens, deadlineAt, signal: options.signal, resolve, reject }
      entry.onAbort = () => {
        this.queue = this.queue.filter(p => p !== entry)
        options.signal?.removeEventListener("abort", entry.onAbort!)
        reject(options.signal?.reason ?? new DOMException("Cancelled", "AbortError"))
        this.pump()
      }
      options.signal?.addEventListener("abort", entry.onAbort, { once: true })
      this.queue.push(entry)
      this.pump()
    })
  }

  private pump(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined }
    const now = Date.now()
    this.used = this.used.filter(e => e.at + this.windowMs > now)
    const expired = this.queue.filter(p => p.tokens > this.tpm || p.deadlineAt <= now || p.signal?.aborted)
    this.queue = this.queue.filter(p => !expired.includes(p))
    for (const entry of expired) {
      entry.signal?.removeEventListener("abort", entry.onAbort!)
      entry.reject(entry.tokens > this.tpm ? new RangeError("Embedding batch exceeds the token-per-minute capacity")
        : entry.signal?.reason ?? new DOMException("Rate-limit deadline exceeded", "TimeoutError"))
    }
    while (this.queue.length) {
      const head = this.queue[0]
      const usedTokens = this.used.reduce((n, e) => n + e.tokens, 0)
      if (this.used.length >= this.rpm || usedTokens + head.tokens > this.tpm) break
      this.queue.shift()
      this.used.push({ at: now, tokens: head.tokens })
      head.signal?.removeEventListener("abort", head.onAbort!)
      head.resolve()
    }
    if (!this.queue.length) return
    const releaseAt = this.used[0] ? this.used[0].at + this.windowMs : now + 1
    const deadlineAt = Math.min(...this.queue.map(p => p.deadlineAt))
    this.timer = setTimeout(() => this.pump(), Math.max(1, Math.min(releaseAt ?? now + 1, deadlineAt) - now))
  }
}

const limiters = new Map<string, RateLimiter>()
export function quotaLimiter(identity: { provider: string; endpoint?: string; region?: string; credential?: string }, rpm: number, tpm: number): RateLimiter | SharedRateLimiter {
  const sharedDirectory = process.env.SENSEGREP_SHARED_QUOTA_DIR
  const sharedScope = process.env.SENSEGREP_SHARED_QUOTA_SCOPE
  if (sharedDirectory || sharedScope) {
    if (!sharedDirectory || !sharedScope?.trim()) throw new Error("Set both SENSEGREP_SHARED_QUOTA_DIR and SENSEGREP_SHARED_QUOTA_SCOPE to enable a shared quota")
    return new SharedRateLimiter(sharedDirectory, sharedScope, rpm, tpm)
  }
  // Never log/store credentials in plain text as registry keys.
  const key = createHash("sha256").update(JSON.stringify([identity.provider, identity.endpoint, identity.region, identity.credential])).digest("hex")
  const existing = limiters.get(key)
  if (existing && !existing.idle) { existing.constrain(rpm, tpm); return existing }
  for (const [id, value] of limiters) if (value.idle) limiters.delete(id)
  if (limiters.size >= 256) throw new Error("Too many active embedding quota identities")
  const limiter = new RateLimiter(rpm, tpm)
  limiters.set(key, limiter)
  return limiter
}

export function validateEmbeddingIndices(data: unknown[], count: number): Array<{ index: number; embedding: number[] }> {
  if (!Number.isSafeInteger(count) || count < 0 || data.length !== count) throw new Error("Embedding input index set is incomplete")
  const seen = new Set<number>()
  const rows = data.map(raw => {
    if (!raw || typeof raw !== "object") throw new Error("Invalid embedding record")
    const row = raw as Record<string, unknown>
    if (!Number.isInteger(row.index) || Number(row.index) < 0 || Number(row.index) >= count || seen.has(Number(row.index))) {
      throw new Error("Invalid, duplicate or missing embedding input index")
    }
    if (!Array.isArray(row.embedding) || row.embedding.some(v => typeof v !== "number" || !Number.isFinite(v))) {
      throw new Error("Embedding coordinates must be finite numbers")
    }
    seen.add(Number(row.index))
    return { index: Number(row.index), embedding: row.embedding as number[] }
  })
  return rows.sort((a, b) => a.index - b.index)
}
