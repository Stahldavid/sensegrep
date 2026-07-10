import path from "node:path"
import { describe, expect, it } from "vitest"
import { Instance } from "./instance.js"

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe("Instance", () => {
  it("isolates project directories across concurrent operations", async () => {
    const firstStarted = deferred()
    const secondStarted = deferred()
    const firstChecked = deferred()
    const firstRoot = path.resolve("packages/core")
    const secondRoot = path.resolve("packages/cli")

    await Promise.all([
      Instance.provide({
        directory: firstRoot,
        fn: async () => {
          firstStarted.resolve()
          await secondStarted.promise
          expect(Instance.directory).toBe(firstRoot)
          firstChecked.resolve()
        },
      }),
      (async () => {
        await firstStarted.promise
        return Instance.provide({
          directory: secondRoot,
          fn: async () => {
            secondStarted.resolve()
            await firstChecked.promise
            expect(Instance.directory).toBe(secondRoot)
          },
        })
      })(),
    ])
  })
})
