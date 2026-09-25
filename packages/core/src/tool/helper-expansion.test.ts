import { afterEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { VectorStore } from "../semantic/lancedb.js"
import { expandHelpers } from "./helper-expansion.js"
import type { SearchResources, WorkingResult } from "./sensegrep-pipeline.js"

afterEach(() => vi.restoreAllMocks())

describe("bounded helper discovery", () => {
  async function fixture(run: (root: string, anchor: WorkingResult) => Promise<void>) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "sensegrep-helpers-"))
    const content = 'import { encryptDestination as protect } from "./crypto.js"\nexport function saveAccount() { return protect(account) }\n'
    await fs.writeFile(path.join(root, "account.ts"), content)
    await fs.writeFile(path.join(root,"crypto.ts"), "export function encryptDestination(account) {\n  return encrypt(account)\n}\n")
    try {
      await run(root, { file: "account.ts", content, startLine: 2, endLine: 2, semanticScore: 0.7, metadata: { symbolName: "saveAccount" } })
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  }
  const row = { id: "helper", content: "export function encryptDestination(account) { return encrypt(account) }", distance: 0,
    metadata: { file: "crypto.ts", symbolName: "encryptDestination", symbolType: "function", startLine: 1, endLine: 3 } }
  it('reports incomplete inspection when a known imported definition is missing from the index',async()=>{
    await fixture(async(root,anchor)=>{
      vi.spyOn(VectorStore,'listDocuments').mockResolvedValue([])
      const result=await expandHelpers({projectDirectory:root,collection:{}} as SearchResources,[anchor],'secret',{},new Set(['account.ts','crypto.ts']),undefined,true)
      expect(result.added).toBe(0)
      expect(result.truncated).toBe(true)
    })
  })
  it('does not make callback parameters or built-in functions into unresolved local definitions',async()=>{
    await fixture(async(root,anchor)=>{
      const content='export function saveAccount(callback) { callback(); return String(12) }'
      await fs.writeFile(path.join(root,'account.ts'),content)
      const list=vi.spyOn(VectorStore,'listDocuments')
      const result=await expandHelpers({projectDirectory:root,collection:{}} as SearchResources,[{...anchor,content,startLine:1,endLine:1}],'secret',{},new Set(['account.ts']),undefined,true)
      expect(result.truncated).toBe(false)
      expect(list).not.toHaveBeenCalled()
    })
  })
  it('uses verified helper lines rather than embedding neighbours or metadata text',async()=>{
    await fixture(async(root,anchor)=>{
      vi.spyOn(VectorStore,'listDocuments').mockResolvedValue([{...row,content:'Embedding context: unrelated function deleteRecords() { wipeDatabase() }'}] as any)
      const expanded=await expandHelpers({projectDirectory:root,collection:{}} as SearchResources,[anchor],'encrypt destination',{},new Set(['account.ts','crypto.ts']),undefined,true)
      const helper=expanded.results.find(r=>r.file==='crypto.ts')!
      expect(helper.content).toBe('export function encryptDestination(account) {\n  return encrypt(account)\n}')
      expect(helper.content).not.toContain('wipeDatabase')
      expect(helper.contentTruncated).toBe(false)
    })
  })
  it('does not invent source when indexed helper ranges are out of bounds',async()=>{
    await fixture(async(root,anchor)=>{
      vi.spyOn(VectorStore,'listDocuments').mockResolvedValue([{...row,metadata:{...row.metadata,endLine:999}}] as any)
      const expanded=await expandHelpers({projectDirectory:root,collection:{}} as SearchResources,[anchor],'encrypt destination',{},new Set(['account.ts','crypto.ts']),undefined,true)
      expect(expanded.added).toBe(0)
      expect(expanded.truncated).toBe(true)
    })
  })
  it("resolves an aliased relative import and preserves structural filters", async () => {
    await fixture(async (root, anchor) => {
      const list = vi.spyOn(VectorStore, "listDocuments").mockResolvedValue([row] as any)
      const filters = { all: [{ key: "language", operator: "equals" as const, value: "typescript" }] }
      const expanded = await expandHelpers({ projectDirectory: root, collection: {} } as SearchResources,
        [anchor], "Where are account destinations encrypted?", filters, new Set(["account.ts", "crypto.ts"]))
      expect(expanded.results.some((r) => r.metadata.symbolName === "encryptDestination")).toBe(true)
      expect(expanded.added).toBe(1)
      expect(list.mock.calls[0][1]?.filters?.all).toEqual(expect.arrayContaining(filters.all))
      expect(expanded.results.at(-1)?.whyMatched?.[0]).toContain("helper expansion")
    })
  })
  it("does not escape the caller's include/exclude or changed-file universe", async () => {
    await fixture(async (root, anchor) => {
      const list = vi.spyOn(VectorStore, "listDocuments")
      const expanded = await expandHelpers({ projectDirectory: root } as SearchResources, [anchor],
        "encrypted destination", {}, new Set(["account.ts"]))
      expect(expanded.results).toEqual([anchor])
      expect(list).not.toHaveBeenCalled()
    })
  })
  it("does not resolve current call sites using stale indexed line ranges", async () => {
    await fixture(async (root, anchor) => {
      const list = vi.spyOn(VectorStore, "listDocuments")
      const expanded = await expandHelpers({ projectDirectory: root, meta: { files: { "account.ts": { hash: "outdated" } } } } as unknown as SearchResources,
        [anchor], "encrypt destination", {}, new Set(["account.ts", "crypto.ts"]))
      expect(expanded.results).toEqual([anchor])
      expect(list).not.toHaveBeenCalled()
    })
  })
  it("does not expand unrelated calls or ambiguous module paths", async () => {
    await fixture(async (root, anchor) => {
      const list = vi.spyOn(VectorStore, "listDocuments")
      for (const [query, files] of [
        ["notification delivery", ["account.ts", "crypto.ts"]],
        ["encrypt destination", ["account.ts", "crypto.ts", "crypto/index.ts"]],
      ] as const) {
        const expanded = await expandHelpers({ projectDirectory: root } as SearchResources, [anchor], query, {}, new Set(files))
        expect(expanded.results).toEqual([anchor])
      }
      expect(list).not.toHaveBeenCalled()
    })
  })
  it("honors caller cancellation", async () => {
    await fixture(async (root, anchor) => {
      await expect(expandHelpers({ projectDirectory: root } as SearchResources, [anchor], "encrypt destination", {},
        new Set(["account.ts", "crypto.ts"]), AbortSignal.abort())).rejects.toThrow()
    })
  })
  it("bounds a stalled database lookup and leaves the original candidates untouched", async () => {
    await fixture(async (root, anchor) => {
      vi.spyOn(VectorStore, "listDocuments").mockImplementation(() => new Promise(() => {}))
      const original = structuredClone(anchor)
      await expect(expandHelpers({ projectDirectory: root, collection: {} } as SearchResources, [anchor],
        "encrypt destination", {}, new Set(["account.ts", "crypto.ts"]))).rejects.toThrow("750ms")
      expect(anchor).toEqual(original)
    })
  })
  it("offers direct helpers without lexical overlap only for Jev and keeps scope", async () => {
    await fixture(async (root, anchor) => {
      vi.spyOn(VectorStore, "listDocuments").mockResolvedValue([row] as any)
      const resources = { projectDirectory: root, collection: {} } as SearchResources
      const local = await expandHelpers(resources, [anchor], "protect financial secrets", {}, new Set(["account.ts", "crypto.ts"]))
      expect(local.results).toEqual([anchor])
      const expanded = await expandHelpers(resources, [anchor], "protect financial secrets", {}, new Set(["account.ts", "crypto.ts"]), undefined, true)
      expect(expanded.results.find(r => r.metadata.symbolName === "encryptDestination")?.jevOnly).toBe(true)
      const scoped = await expandHelpers(resources, [anchor], "protect financial secrets", {}, new Set(["account.ts"]), undefined, true)
      expect(scoped.results).toEqual([anchor])
    })
  })

  it("does not replace an existing source result using a graph-only match", async () => {
    await fixture(async (root, anchor) => {
      vi.spyOn(VectorStore, "listDocuments").mockResolvedValue([row] as any)
      const existing: WorkingResult = { file: "crypto.ts", startLine: 1, endLine: 3,
        content: "complete original implementation", semanticScore: 0.9, metadata: row.metadata }
      const expanded = await expandHelpers({ projectDirectory: root, collection: {} } as SearchResources,
        [anchor, existing], "protect financial secrets", {}, new Set(["account.ts", "crypto.ts"]), undefined, true)
      const retained = expanded.results.find(r => r.file === "crypto.ts")!
      expect({...retained, evidenceRelations:undefined}).toEqual({...existing, evidenceRelations:undefined})
      expect(retained.evidenceRelations?.[0]).toMatchObject({resolved:true, callerTruncated:false})
    })
  })

})
