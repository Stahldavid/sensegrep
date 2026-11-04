import { AsyncSemaphore, abortableSleep } from "../util/async-control.js"
import { assertNetworkAllowed } from "../util/network-policy.js"

export class JevTransportError extends Error {
  constructor(readonly code: string, readonly status?: number) {
    super(code)
    this.name = "JevTransportError"
  }
}
const permits = new AsyncSemaphore(4)

export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (value === null) return undefined
  const seconds = Number(value)
  if (value.trim() && Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : undefined
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined
}

async function boundedJson(response: Response, limit: number): Promise<unknown> {
  if (!response.body) return response.json()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > limit) throw new JevTransportError("response-too-large", response.status)
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

/** One retry for transient transport failures inside the same caller signal.
 * No provider prose is surfaced, cached or interpreted as model evidence. */
export async function sendJevRequest(endpoint: string, body: string, options: {
  apiKey: string; signal: AbortSignal; fetch?: typeof fetch; onAttempt: () => void
}): Promise<Record<string, unknown>> {
  assertNetworkAllowed(endpoint)
  for (let attempt = 0; attempt < 2; attempt++) {
    options.signal.throwIfAborted()
    const release = await permits.acquire(options.signal)
    let retryMs: number | undefined
    try {
      options.signal.throwIfAborted()
      options.onAttempt()
      let response: Response
      try {
        response = await (options.fetch ?? fetch)(endpoint, {
          method: "POST", redirect: "error", signal: options.signal,
          headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" }, body,
        })
      } catch (error) {
        options.signal.throwIfAborted()
        if (!attempt) { retryMs = 200; continue }
        throw new JevTransportError("network-error")
      }
      if (!response.ok) {
        if ([429, 502, 503, 504].includes(response.status) && attempt === 0) {
          retryMs = parseRetryAfter(response.headers?.get("retry-after") ?? null) ?? 200
          // A long Retry-After is not silently shortened into an abusive retry.
          if (retryMs <= 1000) { await response.body?.cancel(); continue }
        }
        let errorCode: unknown
        if (response.status === 400) {
          try {
            const raw = await boundedJson(response, 4096) as { error?: { code?: unknown } }
            errorCode = raw?.error?.code
          } catch { /* Invalid error JSON does not authorize a context split. */ }
        } else await response.body?.cancel()
        const overflow = response.status === 413 || ["context_length_exceeded", "input_too_long", "request_too_large"].includes(String(errorCode))
        throw new JevTransportError(overflow ? "context-overflow"
          : [401, 402, 403, 429].includes(response.status) ? `provider-rejected-${response.status}`
          : response.status === 400 ? "invalid-request" : "provider-error", response.status)
      }
      let raw: unknown
      try { raw = await boundedJson(response, 2 * 1024 * 1024) }
      catch (error) { options.signal.throwIfAborted(); throw error instanceof JevTransportError ? error : new JevTransportError("invalid-response") }
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new JevTransportError("invalid-response")
      return raw as Record<string, unknown>
    } finally {
      release()
      if (retryMs !== undefined && retryMs <= 1000) await abortableSleep(retryMs, options.signal)
    }
  }
  throw new JevTransportError("network-error")
}
