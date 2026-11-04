import { describe, expect, it, vi, afterEach } from "vitest"
import { spawn } from "node:child_process"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import fs from "node:fs/promises"
import { randomUUID } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { build } from "esbuild"
import { SharedRateLimiter } from "./shared-rate-limiter.js"
import { quotaLimiter } from "./rate-limiter.js"
afterEach(() => vi.unstubAllEnvs())
describe("shared local provider budget", () => {
  it("enforces limits across real processes and permits the next window", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sensegrep-quota-"))
    const bundle = path.resolve("node_modules/.cache", `quota-${randomUUID()}.mjs`)
    const children: Array<ReturnType<typeof spawn>> = []
    try {
      await mkdir(path.dirname(bundle), { recursive: true })
      await build({ entryPoints: [path.resolve("packages/core/test-fixtures/shared-quota-worker.ts")], outfile: bundle, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent" })
      const run = () => {
        const child = spawn(process.execPath, [bundle, root, "shared"], { stdio: ["ignore", "ignore", "pipe", "ipc"] }); children.push(child)
        return new Promise<number>((resolve, reject) => { child.on("message", (message: any) => { if (message?.reservedAt) resolve(message.reservedAt); if (message?.error) reject(new Error(message.error)) }); child.once("error", reject); child.once("exit", code => { if (code !== 0) reject(new Error(`child exited: ${code}`)) }) })
      }
      const times = await Promise.all([run(), run()])
      expect(Math.abs(times[0] - times[1])).toBeGreaterThanOrEqual(350)
    } finally {
      for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
      await rm(root, { recursive: true, force: true }); await rm(bundle, { force: true })
    }
  })
  it("removes a cancelled waiter without charging it and rejects mismatched limits", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sensegrep-quota-"))
    try {
      const quota = new SharedRateLimiter(root, "a", 1, 10, 80)
      await quota.acquire(1)
      const ctrl = new AbortController()
      const waiter = quota.acquire(1, { signal: ctrl.signal, deadlineAt: Date.now() + 1000 })
      ctrl.abort()
      await expect(waiter).rejects.toBeDefined()
      await expect(quota.acquire(1, { deadlineAt: Date.now() + 1000 })).resolves.toBeUndefined()
      await expect(new SharedRateLimiter(root, "a", 2, 10, 80).acquire(1)).rejects.toThrow(/limits differ/)
      await expect(new SharedRateLimiter(root, "b", 1, 10, 80).acquire(1)).resolves.toBeUndefined()
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it("is explicitly enabled and rejects partial configuration", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sensegrep-quota-"))
    try {
      vi.stubEnv("SENSEGREP_SHARED_QUOTA_DIR", root)
      vi.stubEnv("SENSEGREP_SHARED_QUOTA_SCOPE", "")
      expect(() => quotaLimiter({ provider: "test" }, 1, 10)).toThrow(/both/)
      vi.stubEnv("SENSEGREP_SHARED_QUOTA_SCOPE", "account")
      expect(quotaLimiter({ provider: "test" }, 1, 10)).toBeInstanceOf(SharedRateLimiter)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it("rejects cancellation after publication while retaining the reservation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sensegrep-quota-"))
    const controller = new AbortController()
    const rename = fs.rename.bind(fs)
    const spy = vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      await rename(from, to)
      controller.abort(new Error("cancelled after reservation"))
    })
    try {
      const limiter = new SharedRateLimiter(root, "a", 1, 10, 200)
      await expect(limiter.acquire(1, { signal: controller.signal, deadlineAt: Date.now() + 1000 })).rejects.toThrow(/cancelled after reservation/)
      spy.mockRestore()
      await expect(limiter.acquire(1, { deadlineAt: Date.now() + 20 })).rejects.toMatchObject({ name: "TimeoutError" })
    } finally { spy.mockRestore(); await rm(root, { recursive: true, force: true }) }
  })
  it("rejects an expired deadline after publication while retaining the reservation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sensegrep-quota-"))
    const rename = fs.rename.bind(fs)
    const spy = vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      await rename(from, to)
      await new Promise(resolve => setTimeout(resolve, 150))
    })
    try {
      const limiter = new SharedRateLimiter(root, "a", 1, 10, 1000)
      await expect(limiter.acquire(1, { deadlineAt: Date.now() + 100 })).rejects.toMatchObject({ name: "TimeoutError" })
      spy.mockRestore()
      await expect(limiter.acquire(1, { deadlineAt: Date.now() + 20 })).rejects.toMatchObject({ name: "TimeoutError" })
    } finally { spy.mockRestore(); await rm(root, { recursive: true, force: true }) }
  })
})
