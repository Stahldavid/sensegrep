// Compare integrated VectorStore.forkCollection full copies and COW views, without a provider.
// Usage: node scripts/benchmark-cow-views.mjs [clients=3] [samples=10] [documents=2000] [dimensions=32]
import { build } from "esbuild"
import { spawn } from "node:child_process"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const clients = Number(process.argv[2] ?? 3), samples = Number(process.argv[3] ?? 10), documents = Number(process.argv[4] ?? 2000), dimensions = Number(process.argv[5] ?? 32)
if (!Number.isInteger(clients) || clients < 1 || clients > 8 || !Number.isInteger(samples) || samples < 2 || samples > 100 || !Number.isInteger(documents) || documents < 100 || documents > 20_000 || !Number.isInteger(dimensions) || dimensions < 8 || dimensions > 128) throw new Error("Expected clients 1..8, samples 2..100, documents 100..20000, dimensions 8..128")
const temporary = await mkdtemp(path.join(tmpdir(), "sensegrep-cow-benchmark-"))
const worker = path.join(repository, "node_modules", ".cache", `cow-benchmark-${randomUUID()}.mjs`)
try {
  await mkdir(path.dirname(worker), { recursive: true })
  await build({ entryPoints: [path.join(repository, "packages/core/test-fixtures/cow-benchmark.ts")], outfile: worker, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent" })
  const results = []
  for (const mode of ["copy", "cow"]) {
    const root = path.join(temporary, mode)
    await mkdir(root)
    const env = { ...process.env, XDG_CONFIG_HOME: path.join(root, "config"), XDG_CACHE_HOME: path.join(root, "cache"), XDG_DATA_HOME: path.join(root, "data"), XDG_STATE_HOME: path.join(root, "state"), SENSEGREP_NETWORK_POLICY: "local-only", SENSEGREP_INDEX_CACHE_MIB: "256", SENSEGREP_METADATA_CACHE_MIB: "64", SENSEGREP_COW_MAX_DEPTH: "8", SENSEGREP_DOCUMENT_CACHE_REVISION: "", SENSEGREP_DOCUMENT_CACHE_ACCOUNT: "", SENSEGREP_SHARED_QUOTA_DIR: "", SENSEGREP_SHARED_QUOTA_SCOPE: "" }
    const output = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [worker, mode, root, String(clients), String(samples), String(documents), String(dimensions)], { cwd: repository, env, stdio: ["ignore", "pipe", "pipe"] })
      let stdout = "", stderr = ""
      child.stdout.on("data", chunk => { stdout += chunk }); child.stderr.on("data", chunk => { stderr += chunk })
      child.once("error", reject)
      child.once("close", code => code === 0 ? resolve(stdout) : reject(new Error(`COW benchmark ${mode} exited ${code}: ${stderr}`)))
    })
    results.push(JSON.parse(output))
  }
  console.log(JSON.stringify({ command: `node scripts/benchmark-cow-views.mjs ${clients} ${samples} ${documents} ${dimensions}`, results }, null, 2))
} finally { await rm(worker, { force: true }); await rm(temporary, { recursive: true, force: true }) }
