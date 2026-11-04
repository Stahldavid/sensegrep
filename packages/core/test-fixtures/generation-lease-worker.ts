import { GenerationLeases } from "../src/semantic/generation-leases.js"
const leases = new GenerationLeases(process.argv[2], process.argv[3])
if (process.argv[4] === "collect") {
  const collected = await leases.collect(async () => {
    process.send?.("collecting")
    await new Promise<void>(resolve => process.once("message", () => resolve()))
  })
  process.send?.({ collected })
  process.disconnect?.()
} else {
const release = await leases.acquire()
process.send?.("acquired")
await new Promise<void>(resolve => process.once("message", () => resolve()))
await release()
process.send?.("released")
process.disconnect?.()
}
