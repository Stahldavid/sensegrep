import { afterAll, afterEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { Instance } from "../project/instance.js"
import { EmbeddingsRemote } from "./embeddings-remote.js"
import { Global } from "../global/index.js"
import { DocumentEmbeddingCache } from "./document-embedding-cache.js"

const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "sensegrep-doc-cache-test-")))
afterAll(() => fs.rm(root, { recursive: true, force: true }))
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

const config = { provider: "openai" as const, embedModel: "test", embedDim: 2, apiKey: "not-a-real-key", baseUrl: "http://127.0.0.1:12345", maxInputTokens: 16 }
function mockProvider() {
  const fetcher = vi.fn(async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    return new Response(JSON.stringify({ data: body.input.map((_: string, index: number) => ({ index, embedding: [3, 4] })) }), { status: 200 })
  })
  vi.stubGlobal("fetch", fetcher)
  return fetcher
}
const embed = (values: string[]) => EmbeddingsRemote.withConfig(config, () => EmbeddingsRemote.embed(values, { taskType: "RETRIEVAL_DOCUMENT" }))

describe("document embedding cache", () => {
  it("is opt-in and coordinates concurrent misses scoped by checkout, profile, account, and revision", async () => {
    const fetcher = mockProvider()
    const a = path.join(root, "a"); const b = path.join(root, "b")
    await Promise.all([fs.mkdir(a), fs.mkdir(b)])
    await Instance.provide({ directory: a, fn: () => embed(["first"]) })
    await Instance.provide({ directory: a, fn: () => embed(["first"]) })
    expect(fetcher).toHaveBeenCalledTimes(2)
    vi.stubEnv("SENSEGREP_DOCUMENT_CACHE_REVISION", "immutable-v1")
    vi.stubEnv("SENSEGREP_DOCUMENT_CACHE_ACCOUNT", "account-a")
    const pair = await Instance.provide({ directory: a, fn: () => Promise.all([embed(["same", "same"]), embed(["same"])]) })
    expect(pair[0]).toEqual([[0.6, 0.8], [0.6, 0.8]])
    expect(fetcher).toHaveBeenCalledTimes(3)
    await Instance.provide({ directory: b, fn: () => embed(["same"]) })
    await Instance.provide({ directory: a, profile: "other", fn: () => embed(["same"]) })
    vi.stubEnv("SENSEGREP_DOCUMENT_CACHE_ACCOUNT", "account-b")
    await Instance.provide({ directory: a, fn: () => embed(["same"]) })
    vi.stubEnv("SENSEGREP_DOCUMENT_CACHE_REVISION", "immutable-v2")
    await Instance.provide({ directory: a, fn: () => embed(["same"]) })
    expect(fetcher).toHaveBeenCalledTimes(7)
  })

  it("keys the post-validation input actually sent, not the raw input", async () => {
    const fetcher = mockProvider()
    vi.stubEnv("SENSEGREP_DOCUMENT_CACHE_REVISION", "v1")
    vi.stubEnv("SENSEGREP_DOCUMENT_CACHE_ACCOUNT", "account")
    const a = path.join(root, "truncated"); await fs.mkdir(a)
    await Instance.provide({ directory: a, fn: () => embed(["x".repeat(1000) + "a", "x".repeat(1000) + "b"]) })
    const body = JSON.parse(String(fetcher.mock.calls[0][1].body))
    expect(body.input).toHaveLength(1)
    expect(body.input[0].length).toBeLessThan(1000)
  })

  it("rejects a malformed cached vector and replaces it with a validated result", async () => {
    const fetcher = mockProvider()
    vi.stubEnv("SENSEGREP_DOCUMENT_CACHE_REVISION", "v1")
    vi.stubEnv("SENSEGREP_DOCUMENT_CACHE_ACCOUNT", "account")
    const a = path.join(root, "corrupt"); await fs.mkdir(a)
    await Instance.provide({ directory: a, fn: () => embed(["private input"]) })
    const scope = createHash("sha256").update(JSON.stringify([a, "default"])).digest("hex")
    const dir = path.join(Global.Path.cache, "document-embeddings-v1", scope)
    const file = (await fs.readdir(dir)).find(name => name.endsWith(".json"))!
    expect(await fs.readFile(path.join(dir, file), "utf8")).not.toContain("private input")
    await fs.writeFile(path.join(dir, file), JSON.stringify({ version: 1, vector: [null, 2] }))
    expect(await Instance.provide({ directory: a, fn: () => embed(["private input"]) })).toEqual([[0.6, 0.8]])
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("includes Gemini's actual document title in the cache key", async () => {
    vi.stubEnv("SENSEGREP_NETWORK_POLICY", "allow")
    vi.stubEnv("SENSEGREP_DOCUMENT_CACHE_REVISION", "v1")
    vi.stubEnv("SENSEGREP_DOCUMENT_CACHE_ACCOUNT", "account")
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ embeddings: [{ values: [3, 4] }] }), { status: 200 }))
    vi.stubGlobal("fetch", fetcher)
    const a = path.join(root, "gemini"); await fs.mkdir(a)
    const run = (title: string) => Instance.provide({ directory: a, fn: () => EmbeddingsRemote.withConfig({ provider: "gemini", embedModel: "test", embedDim: 2, apiKey: "fake" }, () => EmbeddingsRemote.embed(["same"], { taskType: "RETRIEVAL_DOCUMENT", title })) })
    await run("first"); await run("first"); await run("second")
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("waits for the producer before releasing its guard when cancelled", async () => {
    const a = path.join(root, "abort"); await fs.mkdir(a)
    const identity = { revision: "v1", accountScope: "a", provider: "p", model: "m", endpoint: "e", dimension: 2, taskType: "document", input: "input", transform: "v1" }
    let finish!: () => void
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const controller = new AbortController()
    const first = Instance.provide({ directory: a, fn: () => DocumentEmbeddingCache.getOrCompute([identity], async () => { entered(); await new Promise<void>(resolve => { finish = resolve }); return [[1, 0]] }, controller.signal) })
    await started
    controller.abort()
    let secondStarted = false
    const second = Instance.provide({ directory: a, fn: () => DocumentEmbeddingCache.getOrCompute([identity], async () => { secondStarted = true; return [[0, 1]] }) })
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(secondStarted).toBe(false)
    finish()
    await expect(first).rejects.toBeDefined()
    await expect(second).resolves.toEqual([[0, 1]])
  })
})

it("coordinates concurrent processes sharing one cache", async () => {
  const { build } = await import("esbuild")
  const { spawn } = await import("node:child_process")
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sensegrep-cache-workers-"))
  const bundle = path.resolve("node_modules/.cache", `doc-cache-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`)
  const children: Array<ReturnType<typeof spawn>> = []
  const waitMessage = (child: ReturnType<typeof spawn>, expected: string) => new Promise<void>((resolve, reject) => {
    const onMessage = (message: unknown) => { if (message === expected) { child.off("message", onMessage); resolve() } }
    child.on("message", onMessage)
    child.once("error", reject)
    child.once("exit", code => reject(new Error(`worker exited before ${expected}: ${code}`)))
  })
  try {
    await fs.mkdir(path.dirname(bundle), { recursive: true })
    await build({ entryPoints: [path.resolve("packages/core/test-fixtures/document-cache-worker.ts")], outfile: bundle, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent" })
    const start = () => {
      const child = spawn(process.execPath, [bundle, directory], { stdio: ["ignore", "ignore", "pipe", "ipc"], env: { ...process.env, XDG_CONFIG_HOME: path.join(directory, "config"), XDG_CACHE_HOME: path.join(directory, "cache"), XDG_DATA_HOME: path.join(directory, "data"), XDG_STATE_HOME: path.join(directory, "state") } })
      children.push(child); return child
    }
    const a = start()
    await waitMessage(a, "computing")
    const b = start(); const messages: unknown[] = []; b.on("message", message => messages.push(message))
    await waitMessage(b, "ready")
    const aExit = new Promise(resolve => a.once("exit", resolve))
    const bExit = new Promise(resolve => b.once("exit", resolve))
    a.send("finish")
    expect(await aExit).toBe(0)
    expect(await bExit).toBe(0)
    expect(messages).not.toContain("computing")
    expect(messages).toContainEqual({ values: [[0.6, 0.8]] })
  } finally {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
    await fs.rm(bundle, { force: true }); await fs.rm(directory, { recursive: true, force: true })
  }
})
