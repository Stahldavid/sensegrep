export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); reject(signal?.reason ?? new DOMException("Cancelled", "AbortError")) }
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve() }, Math.max(0, ms))
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

/** Process-wide FIFO permits; cancellation removes waiting entries. */
export class AsyncSemaphore {
  private active = 0
  private pending: Array<() => void> = []
  constructor(private readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError("Invalid semaphore capacity")
  }
  acquire(signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted()
    return new Promise((resolve, reject) => {
      const admit = () => {
        signal?.removeEventListener("abort", cancel)
        this.active++
        let released = false
        resolve(() => {
          if (released) return
          released = true
          this.active--
          this.pending.shift()?.()
        })
      }
      const cancel = () => {
        this.pending = this.pending.filter(entry => entry !== admit)
        signal?.removeEventListener("abort", cancel)
        reject(signal?.reason ?? new DOMException("Cancelled", "AbortError"))
      }
      if (this.active < this.capacity) admit()
      else { this.pending.push(admit); signal?.addEventListener("abort", cancel, { once: true }) }
    })
  }
}
