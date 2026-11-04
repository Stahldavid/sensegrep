import { describe, expect, it } from "vitest"
import { spawn, type ChildProcess } from "node:child_process"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { build } from "esbuild"

// Linux supports determining that an owner belongs to the same boot and PID namespace.
describe.skipIf(process.platform !== "linux")("index lock across processes", () => {
  it("serializes two recoverers after the writer is killed", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "sensegrep-lock-test-"))
    const bundle = path.resolve("node_modules/.cache", `index-lock-${randomUUID()}.mjs`)
    const children: ChildProcess[] = []
    try {
      await mkdir(path.dirname(bundle), { recursive: true })
      await build({ entryPoints: [path.resolve("packages/core/test-fixtures/index-lock-worker.ts")], outfile: bundle,
        bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent" })
      const env = { ...process.env, XDG_DATA_HOME: path.join(temp, "data"), XDG_CONFIG_HOME: path.join(temp, "config"),
        XDG_CACHE_HOME: path.join(temp, "cache"), XDG_STATE_HOME: path.join(temp, "state"), SENSEGREP_NETWORK_POLICY: "local-only" }
      type Event = { event: string; pid: number }
      function start() {
        const child = spawn(process.execPath, [bundle, temp], { env, stdio: ["ignore", "ignore", "pipe", "ipc"] })
        children.push(child)
        const events: Event[] = []
        const wake = new Set<() => void>()
        let stderr = ""
        child.stderr!.on("data", chunk => { stderr += String(chunk) })
        child.on("message", event => { events.push(event as Event); for (const notify of wake) notify() })
        child.on("exit", () => { for (const notify of wake) notify() })
        async function next(event: string): Promise<void> {
          const timeout = Date.now() + 12000
          while (!events.some(item => item.event === event)) {
            if (child.exitCode !== null || child.signalCode !== null) throw new Error(`worker exited: ${stderr}`)
            const remaining = timeout - Date.now()
            if (remaining <= 0) throw new Error(`worker timed out waiting for ${event}: ${stderr}`)
            await new Promise<void>(resolve => {
              const done = () => { clearTimeout(timer); wake.delete(done); resolve() }
              const timer = setTimeout(done, remaining)
              wake.add(done)
            })
          }
        }
        return { child, events, next }
      }
      const owner = start()
      await owner.next("acquired")
      const death = new Promise<void>(resolve => owner.child.once("exit", () => resolve()))
      owner.child.kill("SIGKILL")
      await death
      const first = start()
      const second = start()
      await Promise.race([first.next("acquired"), second.next("acquired")])
      const winner = first.events.some(event => event.event === "acquired") ? first : second
      const waiter = winner === first ? second : first
      await waiter.next("waiting")
      expect(waiter.events.some(event => event.event === "acquired")).toBe(false)
      winner.child.send!("release")
      await winner.next("released")
      await waiter.next("acquired")
      waiter.child.send!("release")
      await waiter.next("released")
    } finally {
      for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
      await rm(bundle, { force: true })
      await rm(temp, { recursive: true, force: true })
    }
  }, 30000)
})
