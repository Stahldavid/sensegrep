import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { createHash } from "node:crypto"
import assert from "node:assert/strict"
import { Instance } from "../src/project/instance.js"
import { registerRepository } from "../src/project/repository-identity.js"
import { VectorStore } from "../src/semantic/lancedb.js"

const [mode, root, clientsText, samplesText, countText, dimensionText] = process.argv.slice(2)
const clients = Number(clientsText), samples = Number(samplesText), count = Number(countText), dimension = Number(dimensionText)
if (!["copy", "cow"].includes(mode)) throw new Error("Invalid benchmark mode")
process.env.SENSEGREP_SHARED_OBJECTS = mode === "cow" ? "1" : "0"
process.env.SENSEGREP_ANN_MIN_CHUNKS = "0"
const profile = "benchmark"
const repositoryId = "2f93dd6c-8a70-429d-bc72-4a4e4d615242"
const vector = (text: string) => Array.from({ length: dimension }, (_, index) => createHash("sha256").update(`${index}:${text}`).digest()[0] / 255)
const corpus = Array.from({ length: count }, (_, index) => ({ id: `fixture-${index}`, content: `export function fixture${index}() { return ${index} }\n`, metadata: { file: `src/file-${index}.ts`, startLine: 1, endLine: 1, symbolName: `fixture${index}`, symbolType: "function" } }))
const changed = { ...corpus[0], content: `${corpus[0].content}// changed privately\n` }
const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1]
const summary = (values: number[]) => ({ p50: percentile(values, .5), p95: percentile(values, .95), min: Math.min(...values), max: Math.max(...values) })
async function fileBytes(directory: string, relative = ""): Promise<{ total: number; data: number; files: number }> {
  let total = 0, data = 0, files = 0
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name), childRelative = path.join(relative, entry.name)
    if (entry.isDirectory()) { const child = await fileBytes(filename, childRelative); total += child.total; data += child.data; files += child.files }
    else if (entry.isFile()) { const size = (await fs.stat(filename)).size; total += size; files++; if (childRelative.split(path.sep).includes("data")) data += size }
  }
  return { total, data, files }
}
const sourceRoot = path.join(root, "source checkout")
const roots = Array.from({ length: clients }, (_, index) => path.join(root, `worktree ${index}`))
await fs.mkdir(sourceRoot, { recursive: true })
for (const directory of [sourceRoot, ...roots]) { await fs.mkdir(directory, { recursive: true }); await registerRepository(directory, repositoryId) }
const source = await Instance.provide({ directory: sourceRoot, profile, fn: async () => {
  const staged = await VectorStore.createStagingCollection(sourceRoot, dimension)
  await VectorStore.addEmbeddedDocuments(staged.collection, corpus.map(document => VectorStore.materializeDocument(document, vector(document.content))))
  return { ...staged, directory: VectorStore.getIndexStoragePath(sourceRoot) }
} })
const sourceBytes = await fileBytes(path.join(source.directory, `${source.tableName}.lance`))
const results = []
try {
  for (const scenario of ["unchanged", "one-file-change"]) {
    const forkMs: number[] = [], mutationMs: number[] = [], operationMs: number[] = []
    const ownBeforeBytes: number[] = [], ownBeforeData: number[] = [], ownAfterBytes: number[] = [], ownAfterData: number[] = []
    let sharedViews = 0
    const rssBefore = process.memoryUsage().rss
    for (let sample = 0; sample < samples; sample++) {
      await Promise.all(roots.map(directory => Instance.provide({ directory, profile, fn: async () => {
        const start = performance.now()
        const fork = await VectorStore.forkCollection(directory, source.collection, sourceRoot)
        const forkElapsed = performance.now() - start
        forkMs.push(forkElapsed)
        assert.equal(fork.shared, mode === "cow")
        if (fork.shared) sharedViews++
        const tableDirectory = path.join(VectorStore.getIndexStoragePath(directory), `${fork.tableName}.lance`)
        try {
          const before = await fileBytes(tableDirectory)
          ownBeforeBytes.push(before.total); ownBeforeData.push(before.data)
          if (mode === "cow") assert.equal(before.data, 0, "Native clone must reference source data rather than create duplicate vector fragments")
          const beforeChange = (await fork.collection.query().where("file = 'src/file-0.ts'").toArray())[0]
          assert.equal(beforeChange.content, corpus[0].content)
          const mutateStart = performance.now()
          if (scenario === "one-file-change") await VectorStore.replaceFileDocuments(fork.collection, "src/file-0.ts", [VectorStore.materializeDocument(changed, vector(changed.content))])
          const mutationElapsed = performance.now() - mutateStart
          mutationMs.push(mutationElapsed)
          const after = await fileBytes(tableDirectory)
          ownAfterBytes.push(after.total); ownAfterData.push(after.data)
          operationMs.push(forkElapsed + mutationElapsed)
          const expected = scenario === "one-file-change" ? changed : corpus[0]
          const observed = (await fork.collection.query().where("file = 'src/file-0.ts'").toArray())[0]
          assert.equal(observed.content, expected.content)
          assert.equal(await fork.collection.countRows(), count)
          assert.ok(Array.from(observed.vector as ArrayLike<number>).every((value, index) => Math.abs(value - vector(expected.content)[index]) < 1e-6))
          const ranked = await fork.collection.vectorSearch(vector(expected.content)).distanceType("cosine").where("file = 'src/file-0.ts'").limit(1).toArray()
          assert.equal(ranked[0].content, expected.content)
          assert.ok(Math.abs(Number(ranked[0]._distance)) < 1e-5)
          const base = (await source.collection.query().where("file = 'src/file-0.ts'").toArray())[0]
          assert.equal(base.content, corpus[0].content, "Private view mutation must not change source")
        } finally {
          fork.collection.close()
          await VectorStore.dropCollectionTable(directory, fork.tableName)
        }
      } })))
    }
    const rootCounts = await Promise.all(roots.map(directory => Instance.provide({ directory, profile, fn: async () => {
      const contents = await fs.readdir(VectorStore.getIndexStoragePath(directory))
      return contents.filter(name => name.endsWith(".lance")).length
    } })))
    assert.ok(rootCounts.every(value => value === 0), "Fork cleanup must leave no view table or dependency")
    results.push({ scenario, operations: samples * clients, sharedViews, forkMs: summary(forkMs), mutationMs: summary(mutationMs), forkPlusMutationMs: summary(operationMs), ownTableBytesBefore: summary(ownBeforeBytes), ownDataBytesBefore: summary(ownBeforeData), ownTableBytesAfter: summary(ownAfterBytes), ownDataBytesAfter: summary(ownAfterData), rssBeforeBytes: rssBefore, rssAfterBytes: process.memoryUsage().rss })
  }
  assert.equal(await source.collection.countRows(), count)
  console.log(JSON.stringify({ mode, runtime: "bundled current TypeScript source", node: process.version, platform: `${os.platform()} ${os.release()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem(), clients, registeredRoots: clients + 1, samplesPerClient: samples, corpusDocuments: count, dimensions: dimension, source: { tableBytes: sourceBytes.total, dataBytes: sourceBytes.data, files: sourceBytes.files }, resources: VectorStore.getResourceUsage(), peakRssBytes: process.resourceUsage().maxRSS * (process.platform === "darwin" ? 1 : 1024), result: results, providerCalls: 0, parseWork: "not measured: materialized deterministic fixture", nativeCompaction: "not invoked", timingScope: "fork plus optional one-file replacement; validation and deletion excluded", memoryScope: "one child process per mode, sequential scenarios, shared source handle, client table handles closed after each operation" }, null, 2))
} finally {
  source.collection.close()
  await Instance.provide({ directory: sourceRoot, profile, fn: () => VectorStore.dropCollectionTable(sourceRoot, source.tableName) })
}
