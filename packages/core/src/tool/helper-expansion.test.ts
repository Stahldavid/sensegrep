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
    try {
      await run(root, { file: "account.ts", content, startLine: 2, endLine: 2, semanticScore: 0.7, metadata: { symbolName: "saveAccount" } })
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  }
  const row = { id: "helper", content: "export function encryptDestination(account) { return encrypt(account) }", distance: 0,
    metadata: { file: "crypto.ts", symbolName: "encryptDestination", symbolType: "function", startLine: 1, endLine: 3 } }
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
})
