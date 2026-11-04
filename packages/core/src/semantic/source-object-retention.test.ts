import { describe, expect, it } from "vitest"
import { mkdtemp, mkdir, readFile, rm, stat, writeFile, link, unlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { spawn } from "node:child_process"
import { build } from "esbuild"
import { collectSourceObjects, removeGenerationSourceRefs, withSourceRetentionPin, writeGenerationSourceRefs } from "./source-object-retention.js"
import { admitSharedSource, withSharedSourceGuard } from "./shared-source-retention.js"

const hash = (text: string) => createHash("sha256").update(text).digest("hex")
const metadata = (text: string) => ({ sourceSha256: hash(text), sourceHashKind: "sha256-raw-v1" })

async function fixture(fn: (directory: string, objects: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sensegrep-retention-"))
  const objects = path.join(directory, ".source-objects", "sha256")
  try { await mkdir(objects, { recursive: true }); await fn(directory, objects) }
  finally { await rm(directory, { recursive: true, force: true }) }
}

describe("source retention", () => {
  it("preserves retained generations and publication pins, then releases unreferenced local names", async () => {
    await fixture(async (directory, objects) => {
      await writeFile(path.join(objects, hash("a")), "a")
      await writeFile(path.join(objects, hash("b")), "b")
      await writeGenerationSourceRefs(directory, "generation-a", { "a.ts": metadata("a") })
      await writeGenerationSourceRefs(directory, "generation-b", { "b.ts": metadata("b") })
      await removeGenerationSourceRefs(directory, "generation-a")
      await withSourceRetentionPin(directory, async () => {
        expect((await collectSourceObjects(directory, { generationIds: ["generation-b"] })).skipped).toBe("active-pin")
        expect(await readFile(path.join(objects, hash("a")), "utf8")).toBe("a")
      })
      expect(await collectSourceObjects(directory, { generationIds: ["generation-b"] })).toMatchObject({ removed: 1, reclaimedBytes: 1, remainingBytes: 1 })
      expect(await readFile(path.join(objects, hash("b")), "utf8")).toBe("b")
      await expect(writeGenerationSourceRefs(directory, "generation-b", { "changed.ts": metadata("a") })).rejects.toThrow("immutable generation")
    })
  })

  it("fails closed for unknown generations and unqualified legacy references", async () => {
    await fixture(async (directory, objects) => {
      await writeFile(path.join(objects, hash("a")), "a")
      expect((await collectSourceObjects(directory)).skipped).toBe("unknown-generations")
      expect((await collectSourceObjects(directory, { generationIds: ["unknown"] })).skipped).toBe("unknown-generations")
      await writeGenerationSourceRefs(directory, "legacy", { "a.ts": {} })
      expect((await collectSourceObjects(directory, { generationIds: ["legacy"] })).skipped).toBe("incomplete-reference")
      expect(await readFile(path.join(objects, hash("a")), "utf8")).toBe("a")
    })
  })

  it("evicts only unpinned shared names and rejects capacity rather than evicting referenced objects", async () => {
    await fixture(async (directory, objects) => {
      const shared = path.join(directory, "shared")
      await mkdir(shared)
      const a = hash("a"), b = hash("b")
      const orphan = path.join(shared, `${b}.00000000-0000-0000-0000-000000000000.tmp`)
      await writeFile(orphan, "interrupted")
      await writeFile(path.join(shared, a), "a")
      await link(path.join(shared, a), path.join(objects, a))
      expect((await stat(path.join(shared, a))).nlink).toBe(2)
      await expect(withSharedSourceGuard(shared, () => admitSharedSource(shared, b, 1, { maxBytes: 1 }))).rejects.toThrow("budget exceeded")
      await expect(readFile(orphan)).rejects.toMatchObject({ code: "ENOENT" })
      expect(await readFile(path.join(objects, a), "utf8")).toBe("a")
      await unlink(path.join(objects, a))
      expect(await withSharedSourceGuard(shared, () => admitSharedSource(shared, b, 1, { maxBytes: 1 }))).toMatchObject({ removed: 1, bytes: 1 })
      await expect(readFile(path.join(shared, a))).rejects.toMatchObject({ code: "ENOENT" })
    })
  })

  it("honors a publication pin held by another process", async () => {
    await fixture(async (directory, objects) => {
      await writeFile(path.join(objects, hash("a")), "a")
      const worker = path.join(directory, "worker.mjs")
      await build({ stdin: { contents: `import { withSourceRetentionPin } from ${JSON.stringify(path.resolve("packages/core/src/semantic/source-object-retention.ts"))}; await withSourceRetentionPin(process.argv[2], async () => { process.stdout.write('pinned\\n'); await new Promise(resolve => process.stdin.once('data', resolve)); });`, resolveDir: process.cwd(), loader: "ts" }, outfile: worker, bundle: true, platform: "node", format: "esm", logLevel: "silent" })
      const child = spawn(process.execPath, [worker, directory], { stdio: ["pipe", "pipe", "pipe"] })
      const exit = new Promise<void>((resolve, reject) => { child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(new Error(`pin worker exited ${code}`))) })
      try {
        await new Promise<void>((resolve, reject) => { child.stdout.once("data", () => resolve()); child.once("error", reject); child.once("exit", code => reject(new Error(`pin worker exited early ${code}`))) })
        expect((await collectSourceObjects(directory, { generationIds: [] })).skipped).toBe("active-pin")
        child.stdin.end("release\n")
        await exit
        expect(await collectSourceObjects(directory, { generationIds: [] })).toMatchObject({ removed: 1, remainingBytes: 0 })
      } finally { if (child.exitCode === null) { child.kill(); await exit.catch(() => {}) } }
    })
  })
})
