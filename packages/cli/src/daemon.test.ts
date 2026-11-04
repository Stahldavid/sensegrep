import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { build } from "esbuild"
import { spawn, type ChildProcess } from "node:child_process"
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const output = vi.hoisted(() => ({ writeJson: vi.fn(), writeStdoutLine: vi.fn() }))
vi.mock("./output.js", () => output)
import { runDaemonCommand } from "./daemon.js"

let child: ChildProcess | undefined
let duplicate: ChildProcess | undefined
let temporary: string | undefined
const originalRuntime = process.env.XDG_RUNTIME_DIR
beforeEach(() => vi.stubEnv("SENSEGREP_PROFILE", "default"))

afterEach(async () => {
  child?.kill()
  duplicate?.kill()
  if (originalRuntime === undefined) delete process.env.XDG_RUNTIME_DIR
  else process.env.XDG_RUNTIME_DIR = originalRuntime
  if (temporary) await rm(temporary, { recursive: true, force: true })
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

it("discovers a live daemon by registry identity and ignores stale records", async () => {
  vi.stubEnv("SENSEGREP_PROFILE", "environment-profile")
  temporary = await mkdtemp(path.join(tmpdir(), "sensegrep-daemon-test-"))
  const root = path.join(temporary, "checkout with spaces")
  await mkdir(root)
  process.env.XDG_RUNTIME_DIR = temporary
  const bundle = path.join(temporary, "daemon.mjs")
  await build({ entryPoints: [path.resolve("packages/cli/src/daemon.ts")], outfile: bundle, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent" })
  child = spawn(process.execPath, ["--input-type=module", "-e", `import {runDaemonCommand} from ${JSON.stringify(pathToFileURL(bundle).href)}; await runDaemonCommand('run', {}, process.argv[1])`, root], { env: process.env, stdio: "ignore" })
  let health: any
  for (let i = 0; i < 100; i++) {
    await runDaemonCommand("status", {}, root)
    health = output.writeJson.mock.lastCall?.[0]
    if (health?.ok) break
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  expect(health).toMatchObject({ ok: true, root, protocol: 1, profile: "environment-profile" })
  const registryRoot = path.join(temporary, "sensegrep-daemons")
  const [registry] = await readdir(registryRoot)
  const directory = path.join(registryRoot, registry)
  const file = (await readdir(directory)).find((name) => name.endsWith(".json"))!
  const record = JSON.parse(await readFile(path.join(directory, file), "utf8"))
  const stale = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  await writeFile(path.join(directory, `${stale}.json`), JSON.stringify({ ...record, instance: stale }))
  await runDaemonCommand("status", {}, root)
  expect(output.writeJson.mock.lastCall?.[0].instance).toBe(health.instance)
  await expect(runDaemonCommand("start", { profile: "other" }, root)).rejects.toThrow("configuration mismatch")
  duplicate = spawn(process.execPath, ["--input-type=module", "-e", `import {runDaemonCommand} from ${JSON.stringify(pathToFileURL(bundle).href)}; await runDaemonCommand('run', {}, process.argv[1])`, root], { env: process.env, stdio: "ignore" })
  const code = await new Promise<number | null>((resolve) => duplicate!.once("exit", resolve))
  expect(code).not.toBe(0)
  await runDaemonCommand("status", {}, root)
  expect(output.writeJson.mock.lastCall?.[0].instance).toBe(health.instance)
  await runDaemonCommand("stop", {}, root)
  expect(output.writeJson.mock.lastCall?.[0]).toMatchObject({ ok: true })
}, 15000)

it("elects one process during concurrent starts and fails closed after abrupt owner death", async () => {
  temporary = await mkdtemp(path.join(tmpdir(), "sensegrep-daemon-race-"))
  const root = path.join(temporary, "checkout")
  await mkdir(root)
  process.env.XDG_RUNTIME_DIR = temporary
  const bundle = path.join(temporary, "daemon.mjs")
  await build({ entryPoints: [path.resolve("packages/cli/src/daemon.ts")], outfile: bundle, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent" })
  const args = ["--input-type=module", "-e", `import {runDaemonCommand} from ${JSON.stringify(pathToFileURL(bundle).href)}; await runDaemonCommand('run', {}, process.argv[1])`, root]
  child = spawn(process.execPath, args, { env: process.env, stdio: "ignore" })
  duplicate = spawn(process.execPath, args, { env: process.env, stdio: "ignore" })
  const exited = Promise.race([child, duplicate].map((p) => new Promise<ChildProcess>((resolve) => p.once("exit", () => resolve(p)))))
  const loser = await exited
  expect(loser.exitCode).not.toBe(0)
  const winner = loser === child ? duplicate : child
  let health: any
  for (let i = 0; i < 100; i++) {
    await runDaemonCommand("status", {}, root)
    health = output.writeJson.mock.lastCall?.[0]
    if (health?.ok) break
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  expect(health.pid).toBe(winner.pid)
  const winnerExit = new Promise<void>((resolve) => winner.once("exit", () => resolve()))
  winner.kill("SIGKILL")
  await winnerExit
  const retry = spawn(process.execPath, args, { env: process.env, stdio: "ignore" })
  const retryExit = await new Promise<number | null>((resolve) => retry.once("exit", resolve))
  expect(retryExit).not.toBe(0)
  await runDaemonCommand("status", {}, root)
  expect(output.writeJson.mock.lastCall?.[0].ok).toBe(false)
  expect(output.writeJson.mock.lastCall?.[0].recovery).toMatchObject({ state: "guard-present", verificationRequired: true, resource: "daemon-startup-guard" })
}, 15000)
