import { SharedRateLimiter } from "../src/semantic/shared-rate-limiter.js"
const [directory, scope] = process.argv.slice(2)
const controller = new AbortController()
process.on("message", () => controller.abort(new Error("cancelled")))
process.send?.("ready")
try {
  await new SharedRateLimiter(directory, scope, 1, 10, 400).acquire(1, { signal: controller.signal, deadlineAt: Date.now() + 3000 })
  process.send?.({ reservedAt: Date.now() })
} catch (error) { process.send?.({ error: String(error) }) }
process.disconnect?.()
