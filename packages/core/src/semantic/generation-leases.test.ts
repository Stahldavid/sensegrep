import { describe, expect, it } from "vitest"
import { spawn } from "node:child_process"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { createHash, randomUUID } from "node:crypto"
import { build } from "esbuild"
import { GenerationLeases, GenerationUnavailableError } from "./generation-leases.js"

describe("generation reader coordination", () => {
  it("preserves a live reader and recovers a verifiably dead reader across processes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sensegrep-generation-"))
    const bundle = path.resolve("node_modules/.cache", `generation-reader-${randomUUID()}.mjs`)
    let child: ReturnType<typeof spawn> | undefined
    try {
      await mkdir(path.dirname(bundle), { recursive: true })
      await build({ entryPoints: [path.resolve("packages/core/test-fixtures/generation-lease-worker.ts")], outfile: bundle,
        bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent" })
      child = spawn(process.execPath, [bundle, root, "old"], { stdio: ["ignore", "ignore", "pipe", "ipc"] })
      const acquired = new Promise<void>((resolve, reject) => {
        child!.once("message", () => resolve())
        child!.once("error", reject)
        child!.once("exit", code => reject(new Error(`reader exited: ${code}`)))
      })
      await acquired
      const leases = new GenerationLeases(root, "old")
      let removed = false
      expect(await leases.collect(async () => { removed = true })).toBe(false)
      expect(removed).toBe(false)
      const exit = new Promise<void>(resolve => child!.once("exit", () => resolve()))
      child.kill("SIGKILL")
      await exit
      expect(await leases.collect(async () => { removed = true })).toBe(process.platform === "linux")
      expect(removed).toBe(process.platform === "linux")
      const other = new GenerationLeases(root, "other")
      expect(await other.collect(async () => { removed = true })).toBe(true)
      expect(removed).toBe(true)
      await expect(other.acquire()).rejects.toBeInstanceOf(GenerationUnavailableError)
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
      await rm(bundle, { force: true })
      await rm(root, { recursive: true, force: true })
    }
  })
  it("retains legacy and unverifiable leases instead of guessing ownership", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sensegrep-generation-"))
    try {
      const dir = path.join(root, ".generation-leases", createHash("sha256").update("old").digest("hex"))
      await mkdir(dir, { recursive: true })
      const lease = path.join(dir, "reader-legacy")
      const leases = new GenerationLeases(root, "old")
      await writeFile(lease, "")
      expect(await leases.collect(async () => { throw new Error("must not collect") })).toBe(false)
      await writeFile(lease, JSON.stringify({ version: 1, pid: process.pid, pidScope: "different-boot-or-namespace" }))
      expect(await leases.collect(async () => { throw new Error("must not collect") })).toBe(false)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it("serializes competing collector processes and records completed deletion", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sensegrep-generation-"))
    const bundle = path.resolve("node_modules/.cache", `generation-collector-${randomUUID()}.mjs`)
    const children: ReturnType<typeof spawn>[] = []
    try {
      await mkdir(path.dirname(bundle), { recursive: true })
      await build({ entryPoints: [path.resolve("packages/core/test-fixtures/generation-lease-worker.ts")], outfile: bundle,
        bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent" })
      const start = () => {
        const child = spawn(process.execPath, [bundle, root, "old", "collect"], { stdio: ["ignore", "ignore", "pipe", "ipc"] })
        children.push(child)
        return child
      }
      const first = start()
      await new Promise<void>((resolve, reject) => {
        first.once("message", message => message === "collecting" ? resolve() : reject(new Error("unexpected collector message")))
        first.once("error", reject)
        first.once("exit", code => reject(new Error(`collector exited early: ${code}`)))
      })
      const second = start()
      const messages: unknown[] = []
      second.on("message", message => messages.push(message))
      const firstExit = new Promise(resolve => first.once("exit", resolve))
      const secondExit = new Promise(resolve => second.once("exit", resolve))
      first.send("finish")
      expect(await firstExit).toBe(0)
      expect(await secondExit).toBe(0)
      expect(messages).not.toContain("collecting")
      expect(messages).toContainEqual({ collected: true })
    } finally {
      for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
      await rm(bundle, { force: true })
      await rm(root, { recursive: true, force: true })
    }
  })
  it("reclaims a generation after a live reader releases", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sensegrep-generation-"))
    try {
      const leases = new GenerationLeases(root, "old")
      const release = await leases.acquire()
      expect(await leases.collect(async () => {})).toBe(false)
      await release()
      expect(await leases.collect(async () => {})).toBe(true)
      await expect(leases.acquire()).rejects.toBeInstanceOf(GenerationUnavailableError)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
