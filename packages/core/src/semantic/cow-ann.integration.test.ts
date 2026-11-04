import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import * as lancedb from "@lancedb/lancedb"
import { expect, it, vi } from "vitest"
import { Instance } from "../project/instance.js"
import { registerRepository } from "../project/repository-identity.js"
import { VectorStore } from "./lancedb.js"

const vector = (seed: string) => {
  const bytes = createHash("sha256").update(seed).digest()
  const values = Array.from({ length: 8 }, (_, i) => bytes.readUInt32LE(i * 4) / 0xffffffff - 0.5)
  const norm = Math.hypot(...values)
  return values.map(value => Math.fround(value / norm))
}
const document = (id: string, file: string, values: number[], language = "typescript") => VectorStore.materializeDocument({
  id, content: `export const ${id.replaceAll("-", "_")} = true`,
  metadata: { file, startLine: 1, endLine: 1, symbolName: id, symbolType: "variable", language, type: "code" },
}, values)

it("inherits a real IVF index while isolating deleted files, replacements and unindexed appended vectors", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "sensegrep-cow-ann-"))
  const baseRoot = path.join(temporary, "base checkout"), viewRoot = path.join(temporary, "view checkout")
  await fs.mkdir(baseRoot); await fs.mkdir(viewRoot)
  const repositoryId = randomUUID()
  vi.stubEnv("SENSEGREP_SHARED_OBJECTS", "1")
  vi.stubEnv("SENSEGREP_COW_MAX_DEPTH", "8")
  const run = <T>(root: string, fn: () => Promise<T>) => Instance.provide({ directory: root, profile: "ann-integration", fn })
  type Table = Awaited<ReturnType<typeof VectorStore.createStagingCollection>>["collection"]
  let base: Table | undefined, view: Table | undefined
  try {
    await registerRepository(baseRoot, repositoryId); await registerRepository(viewRoot, repositoryId)
    base = (await run(baseRoot, () => VectorStore.createStagingCollection(baseRoot, 8))).collection
    const rows = Array.from({ length: 1000 }, (_, i) => document(`original-${i}`, `src/group-${i % 4}.ts`, vector(`row-${i}`), i % 2 ? "python" : "typescript"))
    await VectorStore.addEmbeddedDocuments(base, rows)
    await base.createIndex("vector", { config: lancedb.Index.ivfFlat({ numPartitions: 2, distanceType: "cosine" }) })
    expect(await base.listIndices()).toEqual(expect.arrayContaining([expect.objectContaining({ name: "vector_idx", indexType: "IvfFlat", columns: ["vector"] })]))
    expect(await base.indexStats("vector_idx")).toMatchObject({ numIndexedRows: 1000, numUnindexedRows: 0 })

    const fork = await run(viewRoot, () => VectorStore.forkCollection(viewRoot, base!, baseRoot))
    expect(fork.shared).toBe(true)
    view = fork.collection
    expect(await view.listIndices()).toEqual(await base.listIndices())
    expect(await view.indexStats("vector_idx")).toMatchObject({ numIndexedRows: 1000, numUnindexedRows: 0 })

    const query = rows[0].vector
    await VectorStore.deleteByFile(view, "src/group-0.ts")
    await VectorStore.replaceFileDocuments(view, "src/group-1.ts", [
      document("replacement-one", "src/group-1.ts", vector("replacement-one")),
      document("replacement-two", "src/group-1.ts", vector("replacement-two")),
    ])
    await VectorStore.addEmbeddedDocuments(view, [document("new-priority", "src/new.ts", query)])
    expect(await view.countRows()).toBe(503)
    expect(await base.countRows()).toBe(1000)
    expect(await view.indexStats("vector_idx")).toMatchObject({ numUnindexedRows: 3 })
    expect(await view.query().where("file = 'src/group-0.ts'").toArray()).toEqual([])
    expect((await view.query().where("file = 'src/group-1.ts'").select(["id"]).toArray()).map(row => String(row.id)).sort()).toEqual(["replacement-one", "replacement-two"])

    const runQuery = async (table: Table, filter?: string, exact = false, limit = 20) => {
      let builder = table.vectorSearch(query).distanceType("cosine").nprobes(2).limit(limit)
      if (filter) builder = builder.where(filter)
      if (exact) builder = builder.bypassVectorIndex()
      return builder.select(["id", "file", "language", "_distance"]).toArray()
    }
    const assertMatchesExact = async (filter?: string, limit = 20) => {
      const actual = await runQuery(view!, filter, false, limit)
      const exact = await runQuery(view!, filter, true, limit)
      expect(actual.map(row => String(row.id))).toEqual(exact.map(row => String(row.id)))
      for (let i = 0; i < actual.length; i++) expect(Number(actual[i]._distance)).toBeCloseTo(Number(exact[i]._distance), 5)
      return actual
    }
    const unfiltered = await assertMatchesExact()
    expect(unfiltered[0].id).toBe("new-priority")
    expect(unfiltered.every(row => row.file !== "src/group-0.ts")).toBe(true)
    const filtered = await assertMatchesExact("language = 'typescript' AND file != 'src/group-1.ts'", 5)
    expect(filtered).toHaveLength(5)
    expect(filtered[0].id).toBe("new-priority")
    expect(filtered.every(row => row.language === "typescript" && row.file !== "src/group-1.ts")).toBe(true)
    expect((await assertMatchesExact("file = 'src/group-1.ts'", 10))).toHaveLength(2)
    expect(await assertMatchesExact("file = 'src/group-0.ts'", 10)).toEqual([])

    // Prove this was the inherited ANN route, not an unnoticed scan-only fallback.
    const plan = await view.vectorSearch(query).distanceType("cosine").nprobes(2).limit(20).explainPlan()
    expect(plan).toMatch(/ANN|Ivf/i)
    const original = await runQuery(base)
    expect(original[0].id).toBe("original-0")
    expect(original.some(row => row.id === "new-priority" || String(row.id).startsWith("replacement-"))).toBe(false)
    expect(await base.indexStats("vector_idx")).toMatchObject({ numIndexedRows: 1000, numUnindexedRows: 0 })
    expect((await base.query().where("file = 'src/group-0.ts'").select(["id"]).toArray())).toHaveLength(250)
  } finally {
    view?.close(); base?.close()
    await run(viewRoot, () => VectorStore.deleteCollection(viewRoot)).catch(() => {})
    await run(baseRoot, () => VectorStore.deleteCollection(baseRoot)).catch(() => {})
    vi.unstubAllEnvs()
    await fs.rm(temporary, { recursive: true, force: true })
  }
}, 30_000)
