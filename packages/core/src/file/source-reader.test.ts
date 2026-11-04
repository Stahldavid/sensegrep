import { afterEach, beforeEach, describe, expect, it } from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { readProjectSource, sourceContentHash, validateSourceRange } from "./source-reader.js"
import { createResultId } from "../tool/result-id.js"
import { runShowResult } from "../tool/show-result.js"

let dir = "", root = ""
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "sensegrep-source-contract-"))
  root = path.join(dir, "project")
  await fs.mkdir(root)
  await fs.writeFile(path.join(root, "a.ts"), "function rule() { return 1 }\n")
})
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

describe("source confinement and identity", () => {
  it("reads bounded UTF-8 sources and keeps newline-normalized hashes", async () => {
    const result = await readProjectSource(root, "a.ts")
    expect(result.source).toContain("return 1")
    expect(result.hash).toBe(sourceContentHash(result.source))
    expect(sourceContentHash("a\r\nb")).toBe(sourceContentHash("a\nb"))
  })
  it("preserves the original UTF-8 bytes, including a BOM, for snapshot identity", async () => {
    const raw = Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0x0d, 0x0a])
    await fs.writeFile(path.join(root, "a.ts"), raw)
    const result = await readProjectSource(root, "a.ts")
    expect(result.source).toBe("a\r\n")
    expect(result.rawBytes).toEqual(raw)
    expect(result.rawSha256).toBe(createHash("sha256").update(raw).digest("hex"))
  })
  it("rejects lexical traversal and absolute paths", async () => {
    for (const file of ["../outside.ts", "/etc/passwd", "C:\\outside.ts"]) {
      await expect(readProjectSource(root, file)).rejects.toMatchObject({ code: "outside-root" })
    }
  })
  it("rejects directory links before reading outside the project", async context => {
    const outside = path.join(dir, "outside")
    await fs.mkdir(outside); await fs.writeFile(path.join(outside, "x.ts"), "synthetic marker")
    try { await fs.symlink(outside, path.join(root, "link"), process.platform === "win32" ? "junction" : "dir") }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EPERM") return context.skip(); throw error }
    await expect(readProjectSource(root, "link/x.ts")).rejects.toMatchObject({ code: "unsafe-source" })
  })
  it("rejects files exceeding the byte limit and binary content", async () => {
    await expect(readProjectSource(root, "a.ts", { maxBytes: 2 })).rejects.toMatchObject({ code: "source-too-large" })
    await fs.writeFile(path.join(root, "binary"), Buffer.from([0, 1, 2]))
    await expect(readProjectSource(root, "binary")).rejects.toMatchObject({ code: "binary-source" })
  })
  it("honors cancellation and rejects nonexistent ranges", async () => {
    await expect(readProjectSource(root, "a.ts", { signal: AbortSignal.abort() })).rejects.toBeDefined()
    expect(() => validateSourceRange(["one"], 99, 100)).toThrow(/range/)
    await expect(runShowResult({ rootDir: root, resultId: createResultId({ file: "a.ts", startLine: 99, endLine: 100 }) })).rejects.toMatchObject({ code: "invalid-range" })
  })
  it("detects source changes even when the symbol name is unchanged", async () => {
    const id = createResultId({ file: "a.ts", startLine: 1, endLine: 1, symbol: "rule", sourceHash: sourceContentHash("function rule() { return 1 }") })
    expect((await runShowResult({ rootDir: root, resultId: id })).freshness.targetFresh).toBe(true)
    await fs.writeFile(path.join(root, "a.ts"), "function rule() { return 2 }\n")
    expect((await runShowResult({ rootDir: root, resultId: id })).status).toBe("stale-location")
  })
  it("does not fabricate freshness for a legacy location", async () => {
    const id = createResultId({ file: "a.ts", startLine: 1, endLine: 1, symbol: "rule" })
    expect((await runShowResult({ rootDir: root, resultId: id })).freshness.targetFresh).toBeNull()
  })
})
