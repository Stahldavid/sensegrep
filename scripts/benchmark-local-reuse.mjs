// Reproducible microbenchmark of current in-index vector reuse. No provider calls.
// Run after build: node scripts/benchmark-local-reuse.mjs [clients=2] [samples=20]
import { mkdtemp, mkdir, rm, readdir, stat } from "node:fs/promises"
import { tmpdir, cpus, totalmem, platform, release } from "node:os"
import path from "node:path"
import crypto from "node:crypto"
import assert from "node:assert/strict"

const clients = Number(process.argv[2] ?? 2), samples = Number(process.argv[3] ?? 20)
if (!Number.isInteger(clients) || clients < 1 || clients > 8 || !Number.isInteger(samples) || samples < 2 || samples > 1000) throw new Error("clients must be 1..8; samples must be 2..1000")
const temp = await mkdtemp(path.join(tmpdir(), "sensegrep-reuse-bench-"))
process.env.XDG_CONFIG_HOME = path.join(temp, "config")
process.env.XDG_DATA_HOME = path.join(temp, "data")
process.env.XDG_CACHE_HOME = path.join(temp, "cache")
process.env.SENSEGREP_NETWORK_POLICY = "local-only"
const { Instance, VectorStore, Embeddings } = await import("../packages/core/dist/index.js")
// This benchmark never calls a network embedding implementation.
Embeddings.getDimension = () => 8
const dimensions = 8, count = 100
const corpus = Array.from({ length: count }, (_, i) => ({ id: `id-${i}`, content: `export function fixture${i}() { return ${i} }\n`, metadata: { file: `src/file-${i}.ts`, startLine: 1, endLine: 1 } }))
const vector = (text) => Array.from(crypto.createHash("sha256").update(text).digest().subarray(0, dimensions), (x) => x / 255)
const percentile = (data, p) => [...data].sort((a, b) => a - b)[Math.ceil(data.length * p) - 1]
async function bytes(dir) {
  let total = 0
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) total += await bytes(file)
    else if (entry.isFile()) total += (await stat(file)).size
  }
  return total
}
try {
  const roots = await Promise.all(Array.from({ length: clients }, async (_, i) => { const root = path.join(temp, `checkout-${i}`); await mkdir(root); return root }))
  const setups = await Promise.all(roots.map((root) => Instance.provide({ directory: root, profile: "benchmark", fn: async () => {
    const { collection } = await VectorStore.createStagingCollection(root, dimensions)
    await VectorStore.addEmbeddedDocuments(collection, corpus.map((doc) => VectorStore.materializeDocument(doc, vector(doc.content))))
    return collection
  } })))
  const storageBytes = await bytes(path.join(temp, "data"))
  const results = []
  for (const scenario of ["unchanged", "one-change"]) {
    const documents = corpus.map((doc, i) => scenario === "one-change" && i === 0 ? { ...doc, content: `${doc.content}// changed\n` } : doc)
    const baseline = [], reuse = []
    let embedded = 0, reused = 0
    for (let sample = 0; sample < samples; sample++) {
      await Promise.all(roots.map((root, i) => Instance.provide({ directory: root, profile: "benchmark", fn: async () => {
        let start = performance.now()
        const vectors = documents.map((doc) => vector(doc.content))
        baseline.push(performance.now() - start)
        assert.equal(vectors.length, count)
        start = performance.now()
        const found = await VectorStore.reuseDocumentVectors(setups[i], documents)
        found.pending.forEach((doc) => vector(doc.content))
        reuse.push(performance.now() - start)
        assert.equal(found.reused, count - (scenario === "one-change" ? 1 : 0))
        assert.equal(found.pending.length, scenario === "one-change" ? 1 : 0)
        for (const row of found.rows) {
          const expected = vector(row.content)
          assert.ok(row.vector.every((value, index) => Math.abs(value - expected[index]) < 1e-6))
        }
        embedded += found.pending.length
        reused += found.reused
      } })))
    }
    results.push({ scenario, samplesPerClient: samples, baseline: { p50Ms: percentile(baseline, .5), p95Ms: percentile(baseline, .95), embeddingInputs: samples * clients * count }, reuse: { p50Ms: percentile(reuse, .5), p95Ms: percentile(reuse, .95), embeddingInputs: embedded, reusedInputs: reused } })
  }
  console.log(JSON.stringify({ artifact: "packages/core/dist/index.js", node: process.version, platform: `${platform()} ${release()}`, cpu: cpus()[0]?.model, cpuCount: cpus().length, totalMemoryBytes: totalmem(), clients, corpusDocuments: count, dimensions, peakRssBytes: process.resourceUsage().maxRSS * (process.platform === "darwin" ? 1 : 1024), storageBytes, bytesCopied: "not measured; no collection copy", lockWait: "not exercised", results }, null, 2))
} finally { await rm(temp, { recursive: true, force: true }) }
