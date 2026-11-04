import { performance } from "node:perf_hooks"
import { createHash } from "node:crypto"
import os from "node:os"
import { Instance } from "../src/project/instance.js"
import { EmbeddingsRemote } from "../src/semantic/embeddings-remote.js"

const n = Number(process.env.SENSEGREP_BENCH_CLIENTS)
const samples = Number(process.env.SENSEGREP_BENCH_SAMPLES)
const checkout = process.env.SENSEGREP_BENCH_ROOT!
const corpus = Array.from({ length: 100 }, (_, i) => `fixture ${i}: check authorization for resource ${i % 7}`)
let requests = 0
let inputs = 0
let peakRss = process.memoryUsage().rss
const config = { provider: "openai" as const, embedModel: "mock-frozen-model", embedDim: 8, apiKey: "mock-only", baseUrl: "http://127.0.0.1:49123", batchSize: 100 }
globalThis.fetch = async (_url, init) => {
  requests++
  const body = JSON.parse(String(init?.body))
  inputs += body.input.length
  const data = body.input.map((text: string, index: number) => {
    const digest = createHash("sha256").update(text).digest()
    return { index, embedding: Array.from(digest.subarray(0, 8), byte => (byte + 1) / 256) }
  })
  return new Response(JSON.stringify({ data }), { status: 200 })
}
function percentile(values: number[], p: number) { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] }
async function measure(cache: boolean, documents: string[]) {
  if (cache) { process.env.SENSEGREP_DOCUMENT_CACHE_REVISION = "mock-frozen-v1"; process.env.SENSEGREP_DOCUMENT_CACHE_ACCOUNT = "local-synthetic" }
  else { delete process.env.SENSEGREP_DOCUMENT_CACHE_REVISION; delete process.env.SENSEGREP_DOCUMENT_CACHE_ACCOUNT }
  requests = 0; inputs = 0
  const durations: number[] = []
  const started = performance.now()
  await Promise.all(Array.from({ length: n }, async () => {
    for (let i = 0; i < samples; i++) {
      const before = performance.now()
      const vectors = await Instance.provide({ directory: checkout, fn: () => EmbeddingsRemote.withConfig(config, () => EmbeddingsRemote.embed(documents, { taskType: "RETRIEVAL_DOCUMENT" })) })
      if (vectors.length !== documents.length || vectors.some((v, index) => {
        const raw = Array.from(createHash("sha256").update(documents[index]).digest().subarray(0, 8), byte => (byte + 1) / 256)
        const norm = Math.sqrt(raw.reduce((sum, value) => sum + value * value, 0))
        return v.length !== 8 || v.some((x, dimension) => !Number.isFinite(x) || Math.abs(x - raw[dimension] / norm) > 1e-12)
      })) throw new Error("Invalid benchmark vector")
      durations.push(performance.now() - before)
      peakRss = Math.max(peakRss, process.memoryUsage().rss)
    }
  }))
  return { operations: durations.length, p50Ms: percentile(durations, .5), p95Ms: percentile(durations, .95), wallMs: performance.now() - started, simulatedRequests: requests, simulatedInputs: inputs }
}
const changed = [...corpus]; changed[0] += " changed"
const baseline = { unchanged: await measure(false, corpus), changed: await measure(false, changed) }
const cached = { unchanged: await measure(true, corpus), changed: await measure(true, changed) }
console.log(JSON.stringify({ node: process.version, platform: `${process.platform} ${os.release()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem(), clients: n, samplesPerClient: samples, corpusDocuments: corpus.length, dimensions: 8, baseline, cached, peakRssBytes: peakRss }))
