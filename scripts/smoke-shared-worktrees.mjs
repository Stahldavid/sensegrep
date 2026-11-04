// Built-artifact smoke: real Git worktrees + LanceDB, deterministic loopback provider.
// Run after npm run build: node scripts/smoke-shared-worktrees.mjs
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { createHash, randomUUID } from "node:crypto"
import { createServer } from "node:http"
import { spawn, execFile } from "node:child_process"
import { promisify } from "node:util"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath, pathToFileURL } from "node:url"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const cli = process.argv[3] ? path.resolve(process.argv[3]) : path.join(repositoryRoot, "packages/cli/dist/main.js")
const coreUrl = process.argv[2] ? pathToFileURL(path.resolve(process.argv[2])) : new URL("../packages/core/dist/index.js", import.meta.url)
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "sensegrep-shared-worktrees-smoke-"))
const roots = [path.join(temporary, "checkout a"), path.join(temporary, "checkout b")]
const repositoryId = randomUUID(), profile = "shared-worktree-smoke"
const children = new Set()
const execute = promisify(execFile)
let server, embeddingRequests = 0, embeddingInputs = 0
const providerErrors = []

// Isolation must precede dynamic core import: Global resolves XDG paths on import.
for (const key of Object.keys(process.env)) if (key.startsWith("SENSEGREP_") || key.startsWith("OPENCODE_")) delete process.env[key]
Object.assign(process.env, {
  XDG_CONFIG_HOME: path.join(temporary, "config"), XDG_CACHE_HOME: path.join(temporary, "cache"),
  XDG_DATA_HOME: path.join(temporary, "data"), XDG_STATE_HOME: path.join(temporary, "state"),
  SENSEGREP_NETWORK_POLICY: "local-only", SENSEGREP_PROVIDER: "openai", SENSEGREP_PROFILE: profile,
  SENSEGREP_OPENAI_API_KEY: "isolated-deterministic-smoke-key", SENSEGREP_EMBED_MODEL: "fixture", SENSEGREP_EMBED_DIM: "8",
  SENSEGREP_SHARED_OBJECTS: "1", SENSEGREP_ANN_MIN_CHUNKS: "0", SENSEGREP_QUERY_CACHE: "0",
})

function vector(input) {
  return Array.from(createHash("sha256").update(input).digest().subarray(0, 8), value => (value + 1) / 256)
}
async function bytes(directory) {
  let total = 0
  for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(error => { if (error.code === "ENOENT") return []; throw error })) {
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) total += await bytes(filename)
    else if (entry.isFile()) total += (await fs.stat(filename)).size
  }
  return total
}
function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: repositoryRoot, env: process.env, stdio: ["ignore", "pipe", "pipe"] })
    children.add(child)
    let stdout = "", stderr = ""
    const timeout = setTimeout(() => child.kill("SIGKILL"), 45_000)
    child.stdout.on("data", chunk => { stdout += chunk })
    child.stderr.on("data", chunk => { stderr += chunk })
    child.once("error", error => { clearTimeout(timeout); children.delete(child); reject(error) })
    child.once("close", code => {
      clearTimeout(timeout); children.delete(child)
      if (code !== 0) { reject(new Error(`CLI exited ${code}: ${stderr}\n${stdout}`)); return }
      try { resolve(JSON.parse(stdout)) } catch { reject(new Error(`CLI did not return JSON: ${stdout}\n${stderr}`)) }
    })
  })
}
async function git(args) {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", GIT_CONFIG_SYSTEM: process.platform === "win32" ? "NUL" : "/dev/null" }
  delete env.GIT_DIR; delete env.GIT_WORK_TREE; delete env.GIT_INDEX_FILE
  return execute("git", ["-C", roots[0], ...args], { env, timeout: 15_000 })
}

try {
  await fs.access(cli)
  server = createServer(async (request, response) => {
    try {
      if (request.method !== "POST" || request.url !== "/v1/embeddings") { response.writeHead(404); response.end(); return }
      let body = ""
      for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 1024 * 1024) throw new Error("Fixture request too large") }
      const input = JSON.parse(body)
      assert.equal(input.model, "fixture"); assert.equal(input.dimensions, 8); assert.ok(Array.isArray(input.input))
      embeddingRequests++; embeddingInputs += input.input.length
      await delay(50)
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify({ data: input.input.map((text, index) => ({ index, embedding: vector(text) })) }))
    } catch (error) { providerErrors.push(String(error)); response.writeHead(500); response.end(JSON.stringify({ error: "fixture failure" })) }
  })
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve))
  process.env.SENSEGREP_OPENAI_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`
  const { Instance, VectorStore, registerRepository } = await import(coreUrl)
  await fs.mkdir(roots[0])
  await git(["init", "--initial-branch=main"])
  for (let i = 0; i < 4; i++) await fs.writeFile(path.join(roots[0], `fixture${i}.ts`), `export function fixture${i}() { return 'shared value ${i}' }\n`)
  await git(["add", "."])
  await git(["-c", "user.name=Sensegrep Smoke", "-c", "user.email=smoke@example.invalid", "commit", "-m", "isolated worktree fixture"])
  await git(["worktree", "add", "-b", "worktree-b", roots[1], "HEAD"])
  for (const root of roots) await registerRepository(root, repositoryId)

  const summaries = await Promise.all(roots.map(root => runCli(["index", "--root", root, "--profile", profile, "--json", "--no-watch", "--provider", "openai", "--embed-model", "fixture", "--embed-dim", "8"])))
  assert.deepEqual(providerErrors, [])
  assert.equal(embeddingRequests, 1, "Concurrent cold worktrees must coordinate before calling the fixture provider")
  assert.ok(embeddingInputs >= 4)
  assert.deepEqual(summaries.map(summary => summary.result.mode).sort(), ["full", "incremental"])
  const views = await Promise.all(roots.map(root => Instance.provide({ directory: root, profile, fn: async () => {
    const meta = await VectorStore.readIndexMeta(root)
    assert.ok(meta?.tableName); assert.equal(meta.root, await fs.realpath(root)); assert.equal(meta.profile, profile)
    const collection = await VectorStore.getCollectionUnsafe(root, 8, meta.tableName)
    const rows = await VectorStore.listDocuments(collection)
    assert.equal(rows.length, embeddingInputs)
    assert.deepEqual(new Set(rows.map(row => row.metadata.file)), new Set(["fixture0.ts", "fixture1.ts", "fixture2.ts", "fixture3.ts"]))
    collection.close()
    const directory = VectorStore.getIndexStoragePath(root)
    return { root, meta, directory, dataBytes: await bytes(path.join(directory, `${meta.tableName}.lance`, "data")) }
  } })))
  assert.notEqual(views[0].meta.tableName, views[1].meta.tableName)
  assert.equal(views[0].meta.sourceSnapshot.id, views[1].meta.sourceSnapshot.id)
  const sources = views.filter(view => view.dataBytes > 0), clones = views.filter(view => view.dataBytes === 0)
  assert.equal(sources.length, 1); assert.equal(clones.length, 1)
  const source = sources[0], clone = clones[0]
  const hash = source.meta.files["fixture0.ts"].sourceSha256
  const sourceObject = await fs.stat(path.join(source.directory, ".source-objects", "sha256", hash))
  const cloneObject = await fs.stat(path.join(clone.directory, ".source-objects", "sha256", hash))
  assert.deepEqual([sourceObject.dev, sourceObject.ino], [cloneObject.dev, cloneObject.ino])

  // Removing a checkout must not destroy a native base still referenced elsewhere.
  await fs.rm(source.root, { recursive: true, force: true })
  const releasedSource = await runCli(["repository", "release", "--root", source.root, "--profile", profile])
  assert.equal(releasedSource.status, "released"); assert.ok(releasedSource.retainedTables >= 1)
  await Instance.provide({ directory: clone.root, profile, fn: async () => {
    const collection = await VectorStore.getCollectionUnsafe(clone.root, 8, clone.meta.tableName)
    assert.equal((await VectorStore.listDocuments(collection)).length, embeddingInputs)
    collection.close()
  } })
  const releasedClone = await runCli(["repository", "release", "--root", clone.root, "--profile", profile])
  assert.equal(releasedClone.status, "released")
  const collected = await runCli(["repository", "gc", "--root", clone.root, "--profile", profile])
  assert.equal(collected.status, "collected"); assert.equal(collected.retainedTables, 0)
  assert.equal(embeddingRequests, 1, "Release/GC must not call the embedding provider")
  console.log(JSON.stringify({ status: "passed", artifact: "built core and CLI", worktrees: 2, processes: 2, physicalMachines: 1,
    embeddingRequests, embeddingInputs, dataBytes: views.map(view => view.dataBytes), sharedSourceInode: true,
    sourceReleaseRetainedTables: releasedSource.retainedTables, finalRetainedTables: collected.retainedTables,
    externalProvider: false, cleanup: "temporary data removed in finally" }))
} finally {
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
  if (children.size) await Promise.all([...children].map(child => new Promise(resolve => child.once("close", resolve))))
  if (server) await new Promise(resolve => server.close(() => resolve()))
  await fs.rm(temporary, { recursive: true, force: true })
}
