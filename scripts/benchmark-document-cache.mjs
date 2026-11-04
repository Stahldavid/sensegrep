import { build } from "esbuild"
import { spawn } from "node:child_process"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import path from "node:path"
import os from "node:os"
const clients = Number(process.argv[2] ?? 2)
const samples = Number(process.argv[3] ?? 20)
if (!Number.isSafeInteger(clients) || clients < 1 || clients > 8 || !Number.isSafeInteger(samples) || samples < 2 || samples > 1000) throw new Error("Usage: node scripts/benchmark-document-cache.mjs [clients 1-8] [samples 2-1000]")
const root = await mkdtemp(path.join(os.tmpdir(), "sensegrep-doc-cache-bench-"))
const bundle = path.resolve("node_modules/.cache", `doc-cache-bench-${randomUUID()}.mjs`)
try {
  await mkdir(path.dirname(bundle), { recursive: true })
  await build({ entryPoints: [path.resolve("packages/core/test-fixtures/document-cache-benchmark.ts")], outfile: bundle, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent" })
  const env = { ...process.env, XDG_CONFIG_HOME: path.join(root, "config"), XDG_CACHE_HOME: path.join(root, "cache"), XDG_DATA_HOME: path.join(root, "data"), XDG_STATE_HOME: path.join(root, "state"), SENSEGREP_NETWORK_POLICY: "local-only", SENSEGREP_BENCH_CLIENTS: String(clients), SENSEGREP_BENCH_SAMPLES: String(samples), SENSEGREP_BENCH_ROOT: root }
  const child = spawn(process.execPath, [bundle], { env, stdio: "inherit" })
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve) })
  if (code !== 0) throw new Error(`Benchmark child failed: ${code}`)
} finally { await rm(bundle, { force: true }); await rm(root, { recursive: true, force: true }) }
