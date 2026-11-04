/** Generation-based coalescing: a failed refresh never acknowledges dirty work.
 * Each queue belongs to one canonical root/profile; stop waits for the active run. */
export class RefreshQueue {
  private generation = 0
  private acknowledged = 0
  private failures = 0
  private stopped = false
  private active?: Promise<void>
  private timer?: ReturnType<typeof setTimeout>
  private readonly abort = new AbortController()
  private readonly intervalMs: number
  private readonly maxFailures: number

  constructor(private readonly options: {
    intervalMs: number; maxFailures?: number; run:(signal:AbortSignal)=>Promise<void>;
    onError?:(error:unknown,failures:number)=>void
  }) {
    if (!Number.isFinite(options.intervalMs) || options.intervalMs < 1) throw new RangeError('Invalid refresh interval')
    this.intervalMs = options.intervalMs
    this.maxFailures = options.maxFailures ?? 3
    if (!Number.isSafeInteger(this.maxFailures) || this.maxFailures < 1) throw new RangeError('Invalid refresh error limit')
  }

  get state() {
    return {pending:this.generation>this.acknowledged,running:!!this.active,failures:this.failures,
      paused:this.failures>=this.maxFailures,stopped:this.stopped}
  }

  markDirty():void {
    if (this.stopped) return
    this.generation++
    if (this.failures >= this.maxFailures) this.failures = 0
    this.schedule()
  }

  private schedule():void {
    if (this.stopped || this.active || this.timer || this.generation===this.acknowledged || this.failures>=this.maxFailures) return
    const delay=this.intervalMs*Math.pow(2,Math.max(0,this.failures-1))
    this.timer=setTimeout(()=>{this.timer=undefined;this.startRun()},Math.min(delay,2_147_483_647))
    this.timer.unref?.()
  }

  private startRun():void {
    if (this.stopped || this.active) return
    const generation=this.generation
    // Schedule run in a microtask so active is assigned before completion/cleanup.
    this.active=Promise.resolve().then(async()=>{
      try {
        await this.options.run(this.abort.signal)
        this.acknowledged=generation
        this.failures=0
      } catch (error) {
        if (!this.stopped) {
          this.failures++
          // Observer callbacks must not turn the managed job into an unhandled rejection.
          try {this.options.onError?.(error,this.failures)} catch { /* State remains pending. */ }
        }
      }
    }).finally(()=>{this.active=undefined;this.schedule()})
  }

  async stop():Promise<void> {
    this.stopped=true
    if (this.timer) {clearTimeout(this.timer);this.timer=undefined}
    this.abort.abort()
    await this.active
  }
}
