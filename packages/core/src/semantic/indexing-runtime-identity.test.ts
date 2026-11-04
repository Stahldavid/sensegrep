import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import { build } from "esbuild"
import "./language/index.js"
import { getIndexingRuntimeIdentity } from "./indexing-runtime-identity.js"
import { registerLanguage, getLanguageById } from "./language/registry.js"
import { Instance } from "../project/instance.js"

const originalOpen = fs.open.bind(fs)
let checkout: string
beforeEach(async () => { checkout = await fs.mkdtemp(path.join(os.tmpdir(), "sensegrep-runtime-checkout-")) })
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await fs.rm(checkout, { recursive: true, force: true }) })
const identity = () => Instance.provide({ directory: checkout, fn: getIndexingRuntimeIdentity })

describe("local indexing runtime identity", () => {
  it("identifies source artifacts deterministically and includes actual parser binaries", async () => {
    const spy = vi.spyOn(fs, "open")
    const first = await identity()
    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(await identity()).toBe(first)
    expect(spy.mock.calls.some(([filename]) => String(filename).endsWith("tree-sitter-typescript.wasm"))).toBe(true)
    expect(spy.mock.calls.some(([filename]) => String(filename).endsWith("tokenizers.mjs"))).toBe(true)
    expect(spy.mock.calls.some(([filename]) => String(filename).endsWith(path.join("semantic", "chunking.ts")))).toBe(true)
  })

  it("changes identity when runtime file bytes differ without changing the checkout", async () => {
    const before = await identity()
    vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args)
      if (!String(args[0]).endsWith(`${path.sep}semantic${path.sep}chunking.ts`)) return handle
      return new Proxy(handle, { get(target, property) {
        if (property === "read") return async (...readArgs: any[]) => {
          const result = await (target.read as any)(...readArgs)
          if (result.bytesRead > 0) readArgs[0][readArgs[1]] ^= 1
          return result
        }
        const value = Reflect.get(target, property)
        return typeof value === "function" ? value.bind(target) : value
      } })
    })
    const changed = await identity()
    expect(changed).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(changed).not.toBe(before)
  })

  it("fails closed when an installed grammar is unavailable", async () => {
    const originalStat = fs.stat.bind(fs)
    vi.spyOn(fs, "stat").mockImplementation((...args: Parameters<typeof fs.stat>) => {
      if (String(args[0]).endsWith("tree-sitter-python.wasm")) return Promise.reject(Object.assign(new Error("missing grammar"), { code: "ENOENT" })) as any
      return originalStat(...args) as any
    })
    expect(await identity()).toBeUndefined()
  })

  it("fails closed for configured or dynamically registered plugin behavior", async () => {
    vi.stubEnv("SENSEGREP_LANGUAGE_PLUGINS", "./unloaded-plugin.mjs")
    expect(await identity()).toBeUndefined()
    vi.stubEnv("SENSEGREP_LANGUAGE_PLUGINS", "")
    const builtin = getLanguageById("typescript")!
    const dispose = registerLanguage({ ...builtin, id: "identity-fixture", extensions: [".identity-fixture"] })
    try { expect(await identity()).toBeUndefined() }
    finally { dispose() }
    expect(await identity()).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  it("fails closed in an esbuild bundle without a resolvable src/dist artifact layout", async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "sensegrep-runtime-bundle-"))
    const worker = path.resolve("node_modules/.cache", `indexing-identity-${randomUUID()}.mjs`)
    try {
      await fs.mkdir(path.dirname(worker), { recursive: true })
      const filename = path.resolve("packages/core/src/semantic/indexing-runtime-identity.ts")
      await build({ stdin: { contents: `import { getIndexingRuntimeIdentity } from ${JSON.stringify(filename)}; console.log(JSON.stringify({ identity: await getIndexingRuntimeIdentity() ?? null }));`, sourcefile: "runtime-identity-worker.ts", resolveDir: process.cwd(), loader: "ts" }, outfile: worker, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent" })
      const result = await new Promise<{ code: number | null; out: string; err: string }>((resolve, reject) => {
        const child = spawn(process.execPath, [worker], { env: { ...process.env, XDG_CONFIG_HOME: path.join(temporary, "config"), XDG_CACHE_HOME: path.join(temporary, "cache"), XDG_DATA_HOME: path.join(temporary, "data"), XDG_STATE_HOME: path.join(temporary, "state"), SENSEGREP_NETWORK_POLICY: "local-only" }, stdio: ["ignore", "pipe", "pipe"] })
        let out = "", err = ""
        child.stdout.on("data", chunk => { out += chunk }); child.stderr.on("data", chunk => { err += chunk })
        child.once("error", reject); child.once("close", code => resolve({ code, out, err }))
      })
      expect(result.code, result.err).toBe(0)
      expect(JSON.parse(result.out)).toEqual({ identity: null })
    } finally { await fs.rm(worker, { force: true }); await fs.rm(temporary, { recursive: true, force: true }) }
  })
})
