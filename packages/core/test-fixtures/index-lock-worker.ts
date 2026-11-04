import { Instance } from "../src/project/instance.js"
import { Indexer } from "../src/semantic/indexer.js"

const root = process.argv[2]
await Instance.provide({ directory: root, fn: () => Indexer.withIndexLockForTesting({ timeoutMs: 15000, onProgress: () => process.send?.({ event: "waiting", pid: process.pid }) }, async () => {
  process.send?.({ event: "acquired", pid: process.pid })
  await new Promise<void>((resolve) => process.once("message", () => resolve()))
}) })
process.send?.({ event: "released", pid: process.pid })
process.disconnect?.()
