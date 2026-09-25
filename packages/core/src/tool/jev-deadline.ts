/** Reserve a final verification and one repair cycle inside the caller's deadline.
 * These are scheduling budgets, not quality thresholds or model probabilities. */
export function jevDeadline(totalMs: number, now = Date.now) {
  const start = now(), total = Math.max(1,totalMs)
  const verificationMs = Math.min(1500,Math.floor(total*.2))
  const recoveryMs = Math.min(3000,Math.floor(total*.3))
  const initialMs = Math.max(1,total-verificationMs-recoveryMs)
  const remaining = () => Math.max(0,total-(now()-start))
  return {start, remaining, initial:()=>Math.max(0,Math.min(initialMs,remaining()-verificationMs-recoveryMs)),
    repair:()=>Math.max(0,remaining()-verificationMs),
    preliminary:()=>Math.max(0,Math.min(verificationMs,remaining()-verificationMs-recoveryMs)),
    allocation:{totalMs:total,initialMs,recoveryMs,verificationMs}}
}
