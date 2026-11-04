import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { randomUUID, randomBytes, createHash } from "node:crypto"
import { spawn, type ChildProcess } from "node:child_process"
import { build } from "esbuild"
import { afterEach, expect, it, vi } from "vitest"
import { Global } from "../global/index.js"
import { registerRepository } from "../project/repository-identity.js"
import { withRepositoryIndexBudget } from "./repository-index-budget.js"

afterEach(() => vi.unstubAllEnvs())
const allocated = async (filename: string) => { const stat = await fs.stat(filename); return process.platform !== "win32" ? stat.blocks * 512 : stat.size }
async function fixture(fn: (input: { temporary: string; repositoryId: string; rootA: string; rootB: string; indexA: string; indexB: string }) => Promise<void>) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "sensegrep-index-budget-"))
  const repositoryId = randomUUID()
  let rootA = path.join(temporary, "a"), rootB = path.join(temporary, "b")
  const indexA = path.join(Global.Path.data, ".lancedb", `project_budget_a_${randomUUID().replaceAll("-", "")}`)
  const indexB = path.join(Global.Path.data, ".lancedb", `project_budget_b_${randomUUID().replaceAll("-", "")}`)
  try {
    await Promise.all([fs.mkdir(rootA), fs.mkdir(rootB), fs.mkdir(indexA, { recursive: true }), fs.mkdir(indexB, { recursive: true })])
    rootA = await fs.realpath(rootA); rootB = await fs.realpath(rootB)
    await registerRepository(rootA, repositoryId); await registerRepository(rootB, repositoryId)
    await fn({ temporary, repositoryId, rootA, rootB, indexA, indexB })
  } finally { await Promise.all([fs.rm(temporary, { recursive: true, force: true }), fs.rm(indexA, { recursive: true, force: true }), fs.rm(indexB, { recursive: true, force: true })]) }
}
async function table(index: string, name: string, bytes = 4096) {
  const directory = path.join(index, `${name}.lance`, "data")
  await fs.mkdir(directory, { recursive: true })
  const filename = path.join(directory, "fragment.lance")
  // Test actual allocated bytes, not compressible or delayed-allocation data.
  const handle = await fs.open(filename, "wx")
  try { await handle.writeFile(randomBytes(bytes)); await handle.sync() } finally { await handle.close() }
  return filename
}
const publish = (index: string, root: string) => fs.writeFile(path.join(index, "index-meta.json"), JSON.stringify({ root }))

it("preserves private fallback and validates limits only for registered shared views", async () => {
  const privateRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sensegrep-private-budget-"))
  try {
    vi.stubEnv("SENSEGREP_SHARED_OBJECTS", "0")
    vi.stubEnv("SENSEGREP_SHARED_INDEX_MAX_BYTES", "invalid")
    expect(await withRepositoryIndexBudget(privateRoot, "/not-used", async () => "private")).toBe("private")
    vi.stubEnv("SENSEGREP_SHARED_OBJECTS", "1")
    expect(await withRepositoryIndexBudget(privateRoot, "/not-used", async () => "unregistered")).toBe("unregistered")
    await registerRepository(privateRoot, randomUUID())
    await expect(withRepositoryIndexBudget(privateRoot, "/not-used", async () => "invalid")).rejects.toThrow("non-negative safe integer")
  } finally { await fs.rm(privateRoot, { recursive: true, force: true }) }
})

it("counts all retained tables and vanished-worktree roots, deduplicates hardlinks, and never evicts pinned data", async () => fixture(async ({ rootA, rootB, indexA, indexB }) => {
  vi.stubEnv("SENSEGREP_SHARED_OBJECTS", "1")
  const base = await table(indexA, "base"), extra = await table(indexB, "private")
  const linked = path.join(indexB, "clone.lance", "data", "fragment.lance")
  await fs.mkdir(path.dirname(linked), { recursive: true }); await fs.link(base, linked)
  await publish(indexA, rootA); await publish(indexB, rootB)
  const total = await allocated(base) + await allocated(extra)
  vi.stubEnv("SENSEGREP_SHARED_INDEX_MAX_BYTES", String(total))
  await expect(withRepositoryIndexBudget(rootB, indexB, async () => "fits")).resolves.toBe("fits")
  await fs.rm(rootA, { recursive: true })
  vi.stubEnv("SENSEGREP_SHARED_INDEX_MAX_BYTES", String(total - 1))
  const activate = vi.fn(async () => "must not activate")
  await expect(withRepositoryIndexBudget(rootB, indexB, activate)).rejects.toThrow("budget exceeded")
  expect(activate).not.toHaveBeenCalled()
  expect((await fs.stat(base)).size).toBe(4096)
  expect((await fs.stat(extra)).size).toBe(4096)
  expect((await fs.stat(linked)).ino).toBe((await fs.stat(base)).ino)
}))

it("does not charge an index registered to a different repository", async () => fixture(async ({ temporary, rootA, indexA, indexB }) => {
  vi.stubEnv("SENSEGREP_SHARED_OBJECTS", "1")
  const other = path.join(temporary, "other"); await fs.mkdir(other); await registerRepository(other, randomUUID())
  const included = await table(indexA, "included")
  await table(indexB, "unrelated", 8192)
  await publish(indexA, rootA); await publish(indexB, other)
  vi.stubEnv("SENSEGREP_SHARED_INDEX_MAX_BYTES", String(await allocated(included)))
  await expect(withRepositoryIndexBudget(rootA, indexA, async () => "fits")).resolves.toBe("fits")
}))

it("resolves metadata aliases through an existing ancestor after a worktree disappears", async () => fixture(async ({ temporary, rootA, rootB, indexA, indexB }) => {
  vi.stubEnv("SENSEGREP_SHARED_OBJECTS", "1")
  const alias = path.join(temporary, "checkout-parent-alias")
  await fs.symlink(await fs.realpath(temporary), alias, process.platform === "win32" ? "junction" : "dir")
  const source = await table(indexA, "aliased-retained")
  const current = await table(indexB, "current")
  await publish(indexA, path.join(alias, path.basename(rootA)))
  await publish(indexB, rootB)
  await fs.rm(rootA, { recursive: true })
  vi.stubEnv("SENSEGREP_SHARED_INDEX_MAX_BYTES", String(await allocated(current)))
  const activate = vi.fn(async () => "must not publish")
  await expect(withRepositoryIndexBudget(rootB, indexB, activate)).rejects.toThrow("budget exceeded")
  expect(activate).not.toHaveBeenCalled()
  expect((await fs.stat(source)).size).toBe(4096)
}))

it("counts released source tables retained by descendants after metadata removal", async () => fixture(async ({ repositoryId, rootA, rootB, indexA, indexB }) => {
  vi.stubEnv("SENSEGREP_SHARED_OBJECTS", "1")
  const source = await table(indexA, "retained-source")
  const privateRows = await table(indexB, "descendant-private")
  await publish(indexA, rootA); await publish(indexB, rootB)
  await fs.writeFile(path.join(indexA, ".released-view.json"), JSON.stringify({ version: 1, root: rootA, profile: "default", repositoryId }))
  await fs.unlink(path.join(indexA, "index-meta.json"))
  vi.stubEnv("SENSEGREP_SHARED_INDEX_MAX_BYTES", String(await allocated(privateRows)))
  const publishDescendant = vi.fn(async () => "published")
  await expect(withRepositoryIndexBudget(rootB, indexB, publishDescendant)).rejects.toThrow("budget exceeded")
  expect(publishDescendant).not.toHaveBeenCalled()
  expect((await fs.stat(source)).size).toBe(4096)
}))

it("counts binding-owned retained and staged directories without metadata or markers", async () => fixture(async ({ rootA, rootB, indexB }) => {
  vi.stubEnv("SENSEGREP_SHARED_OBJECTS", "1")
  const canonical = process.platform === "win32" ? rootA.toLowerCase() : rootA
  const rootHash = createHash("sha256").update(canonical).digest("hex").slice(0, 24)
  const profileHash = createHash("sha256").update("retained-profile").digest("hex").slice(0, 12)
  const retained = path.join(Global.Path.data, ".lancedb", `project_${rootHash}_${profileHash}`)
  try {
    const source = await table(retained, "retained-base", 8192)
    const privateRows = await table(indexB, "new-descendant", 4096)
    await fs.rm(rootA, { recursive: true })
    vi.stubEnv("SENSEGREP_SHARED_INDEX_MAX_BYTES", String(await allocated(privateRows)))
    const activate = vi.fn(async () => "published")
    await expect(withRepositoryIndexBudget(rootB, indexB, activate)).rejects.toThrow("budget exceeded")
    expect(activate).not.toHaveBeenCalled()
    expect((await fs.stat(source)).size).toBe(8192)
  } finally { await fs.rm(retained, { recursive: true, force: true }) }
}))

it("serializes measurement and publication across two processes and rejects the second over-budget activation", async () => fixture(async ({ temporary, rootA, rootB, indexA, indexB }) => {
  vi.stubEnv("SENSEGREP_SHARED_OBJECTS", "1")
  const firstData = await table(indexA, "first"); await table(indexB, "second")
  vi.stubEnv("SENSEGREP_SHARED_INDEX_MAX_BYTES", String(await allocated(firstData)))
  const worker = path.resolve("node_modules/.cache", `repository-budget-${randomUUID()}.mjs`)
  const children: ChildProcess[] = []
  const events = new Map<ChildProcess, unknown[]>()
  const wait = (child: ChildProcess, wanted: string) => new Promise<void>((resolve, reject) => {
    if (events.get(child)?.includes(wanted)) { resolve(); return }
    const message = (value: unknown) => { if (value === wanted) { child.off("message", message); resolve() } }
    child.on("message", message); child.once("error", reject); child.once("exit", code => reject(new Error(`worker exited before ${wanted}: ${code}`)))
  })
  try {
    await fs.mkdir(path.dirname(worker), { recursive: true })
    await build({ stdin: { contents: `import fs from 'node:fs/promises'; import path from 'node:path'; import { withRepositoryIndexBudget } from ${JSON.stringify(path.resolve("packages/core/src/semantic/repository-index-budget.ts"))};
process.send?.('ready');
try { await withRepositoryIndexBudget(process.argv[2], process.argv[3], async () => { process.send?.('entered'); if (process.argv[4] === 'wait') await new Promise(resolve => process.once('message', resolve)); await fs.writeFile(path.join(process.argv[3], 'index-meta.json'), JSON.stringify({root:process.argv[2]})); }); process.send?.('published'); }
catch (error) { if (!String(error.message).includes('budget exceeded')) throw error; process.send?.('rejected'); process.exitCode=2; }
process.disconnect?.();`, resolveDir: process.cwd(), loader: "ts" }, outfile: worker, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent" })
    const start = (root: string, index: string, pause: boolean) => {
      const child = spawn(process.execPath, [worker, root, index, pause ? "wait" : "run"], { stdio: ["ignore", "ignore", "pipe", "ipc"], env: process.env })
      events.set(child, []); child.on("message", value => events.get(child)!.push(value)); children.push(child); return child
    }
    const a = start(rootA, indexA, true); await wait(a, "entered")
    const b = start(rootB, indexB, false); await wait(b, "ready")
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(events.get(b)).not.toContain("entered")
    const doneA = new Promise(resolve => a.once("exit", resolve)), doneB = new Promise(resolve => b.once("exit", resolve))
    a.send("continue")
    expect(await doneA).toBe(0); expect(await doneB).toBe(2)
    expect(events.get(b)).toContain("rejected")
    expect(events.get(b)).not.toContain("entered")
    expect(JSON.parse(await fs.readFile(path.join(indexA, "index-meta.json"), "utf8"))).toMatchObject({ root: rootA })
    await expect(fs.readFile(path.join(indexB, "index-meta.json"))).rejects.toMatchObject({ code: "ENOENT" })
  } finally {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
    await fs.rm(worker, { force: true })
  }
}), 15_000)
