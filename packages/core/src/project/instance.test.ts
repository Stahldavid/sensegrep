import path from "node:path"
import fs from "node:fs/promises"
import os from "node:os"
import { describe, expect, it } from "vitest"
import { Instance } from "./instance.js"
import { canonicalCheckoutPath } from "./paths.js"

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe("Instance", () => {
  it("inherits a nested same-directory profile but not across projects", async () => {
    await Instance.provide({ directory: ".", profile: "alpha", fn: async () => {
      await Instance.provide({ directory: ".", fn: () => expect(Instance.profile).toBe("alpha") })
      await Instance.provide({ directory: "packages", fn: () => expect(Instance.profile).not.toBe("alpha") })
    } })
  })
  it("isolates project directories across concurrent operations", async () => {
    const firstStarted = deferred()
    const secondStarted = deferred()
    const firstChecked = deferred()
    const firstRoot = canonicalCheckoutPath("packages/core")
    const secondRoot = canonicalCheckoutPath("packages/cli")

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

  it("isolates named profiles across concurrent operations", async () => {
    const first = deferred()
    const second = deferred()
    await Promise.all([
      Instance.provide({ directory: ".", profile: "local", fn: async () => {
        first.resolve()
        await second.promise
        expect(Instance.profile).toBe("local")
      } }),
      (async () => {
        await first.promise
        return Instance.provide({ directory: ".", profile: "remote", fn: async () => {
          second.resolve()
          expect(Instance.profile).toBe("remote")
        } })
      })(),
    ])
  })

  it("canonicalizes removed checkout aliases and inherits their nested profile", async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "sensegrep-context-alias-"))
    try {
      const parent = path.join(temporary, "physical-parent"), alias = path.join(temporary, "parent-alias")
      await fs.mkdir(parent)
      await fs.symlink(await fs.realpath(parent), alias, process.platform === "win32" ? "junction" : "dir")
      const root = path.join(parent, "RemovedCheckout"), viaAlias = path.join(alias, process.platform === "win32" ? "removedcheckout" : "RemovedCheckout")
      await fs.mkdir(root); await fs.rm(root, { recursive: true })
      const expected = path.join(await fs.realpath(parent), "RemovedCheckout")
      expect(canonicalCheckoutPath(root)).toBe(expected)
      expect(canonicalCheckoutPath(path.join(alias, "RemovedCheckout", "nested"))).toBe(path.join(expected, "nested"))
      await Instance.provide({ directory: root, profile: "alias-profile", fn: async () => {
        await Instance.provide({ directory: viaAlias, fn: () => {
          expect(Instance.directory).toBe(canonicalCheckoutPath(viaAlias))
          expect(Instance.profile).toBe("alias-profile")
        } })
      } })
    } finally { await fs.rm(temporary, { recursive: true, force: true }) }
  })

  it("uses one mutation lock for concurrent aliases of a removed checkout", async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "sensegrep-lock-alias-"))
    const entered = deferred(), release = deferred()
    const pending: Array<Promise<unknown>> = []
    try {
      const parent = path.join(temporary, "physical-parent"), alias = path.join(temporary, "parent-alias")
      await fs.mkdir(parent)
      await fs.symlink(await fs.realpath(parent), alias, process.platform === "win32" ? "junction" : "dir")
      const root = path.join(parent, "RemovedCheckout"), viaAlias = path.join(alias, process.platform === "win32" ? "removedcheckout" : "RemovedCheckout")
      await fs.mkdir(root); await fs.rm(root, { recursive: true })
      const { Indexer } = await import("../semantic/indexer.js")
      const events: string[] = []
      pending.push(Instance.provide({ directory: root, profile: "alias-lock", fn: () => Indexer.withProjectMutation(async () => {
        events.push("first-enter"); entered.resolve(); await release.promise; events.push("first-exit")
      }) }))
      await entered.promise
      const second = Instance.provide({ directory: viaAlias, profile: "alias-lock", fn: () => Indexer.withIndexLockForTesting({ timeoutMs: 100 }, async () => { events.push("second-enter") }) })
      pending.push(second)
      await expect(second).rejects.toThrow("Timed out")
      expect(events).toEqual(["first-enter"])
      release.resolve(); await pending[0]
      await Instance.provide({ directory: viaAlias, profile: "alias-lock", fn: () => Indexer.withProjectMutation(async () => { events.push("third-enter") }) })
      expect(events).toEqual(["first-enter", "first-exit", "third-enter"])
    } finally { release.resolve(); await Promise.allSettled(pending); await fs.rm(temporary, { recursive: true, force: true }) }
  })

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("does not replace permission failures with a guessed checkout path", async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "sensegrep-context-permission-"))
    const inaccessible = path.join(temporary, "inaccessible")
    await fs.mkdir(inaccessible)
    try {
      await fs.chmod(inaccessible, 0)
      await expect(Instance.provide({ directory: path.join(inaccessible, "missing"), fn: () => "must not enter" })).rejects.toMatchObject({ code: "EACCES" })
    } finally { await fs.chmod(inaccessible, 0o700); await fs.rm(temporary, { recursive: true, force: true }) }
  })
})
