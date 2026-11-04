import { describe, expect, it } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import * as lancedb from "@lancedb/lancedb"
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { build } from "esbuild"
import { cloneDependencyDepth, findCloneDependents, recordCloneDependency, removeCloneDependency, withCloneGuard } from "./clone-dependencies.js"

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sensegrep-clone-deps-"))
  const database = path.join(root, "database")
  await fs.mkdir(database)
  const canonicalDatabase = await fs.realpath(database)
  const identityDirectory = process.platform === "win32" ? canonicalDatabase.toLowerCase() : canonicalDatabase
  return { root, database: canonicalDatabase, scope: { directory: path.join(root, "coordination") }, address: (table: string) => ({ directory: identityDirectory, table }) }
}

describe("copy-on-write clone dependencies", () => {
  it("preserves transitive pins, rejects cycles and releases only a leaf", async () => {
    const f = await fixture()
    try {
      await expect(findCloneDependents(f.address("base"))).rejects.toThrow("guard")
      await withCloneGuard(async () => {
        expect(await cloneDependencyDepth(f.address("base"))).toBe(0)
        await recordCloneDependency(f.address("base"), f.address("alpha"))
        await recordCloneDependency(f.address("alpha"), f.address("beta"))
        expect(await cloneDependencyDepth(f.address("beta"))).toBe(2)
        expect(await findCloneDependents(f.address("base"))).toEqual([f.address("alpha")])
        await expect(removeCloneDependency(f.address("alpha"))).rejects.toThrow("descendants")
        await expect(recordCloneDependency(f.address("beta"), f.address("base"))).rejects.toThrow("cycle")
        expect(await cloneDependencyDepth(f.address("base"))).toBe(0)
        await removeCloneDependency(f.address("beta"))
        await removeCloneDependency(f.address("alpha"))
        expect(await findCloneDependents(f.address("base"))).toEqual([])
      }, f.scope)
    } finally { await fs.rm(f.root, { recursive: true, force: true }) }
  })

  it("fails closed on missing or corrupt initialized registry", async () => {
    const f = await fixture()
    try {
      await withCloneGuard(() => recordCloneDependency(f.address("base"), f.address("view")), f.scope)
      const registry = path.join(f.scope.directory, "dependencies.json")
      await fs.unlink(path.join(f.scope.directory, "initialized"))
      await withCloneGuard(async () => {
        expect(await findCloneDependents(f.address("base"))).toEqual([f.address("view")])
      }, f.scope)
      expect((await fs.stat(path.join(f.scope.directory, "initialized"))).isFile()).toBe(true)
      await fs.unlink(registry)
      await expect(withCloneGuard(() => findCloneDependents(f.address("base")), f.scope)).rejects.toThrow("missing")
      await fs.writeFile(registry, "{broken")
      await expect(withCloneGuard(() => findCloneDependents(f.address("base")), f.scope)).rejects.toThrow()
      await expect(fs.stat(path.join(f.scope.directory, "guard"))).rejects.toMatchObject({ code: "ENOENT" })
    } finally { await fs.rm(f.root, { recursive: true, force: true }) }
  })

  it("serializes contenders, preserves abandoned guards and supports cancellation", async () => {
    const f = await fixture()
    try {
      const events: string[] = []
      let entered!: () => void
      const firstEntered = new Promise<void>(resolve => { entered = resolve })
      let release!: () => void
      const releaseFirst = new Promise<void>(resolve => { release = resolve })
      const first = withCloneGuard(async () => { events.push("first-enter"); entered(); await releaseFirst; events.push("first-exit") }, f.scope)
      await firstEntered
      const controller = new AbortController()
      const cancelled = withCloneGuard(async () => { events.push("cancelled-enter") }, { ...f.scope, signal: controller.signal })
      controller.abort(new Error("cancelled waiting clone"))
      await expect(cancelled).rejects.toThrow("cancelled waiting clone")
      const successor = withCloneGuard(async () => { events.push("next-enter") }, f.scope)
      release(); await first; await successor
      expect(events).toEqual(["first-enter", "first-exit", "next-enter"])
      await fs.mkdir(path.join(f.scope.directory, "guard"))
      await expect(withCloneGuard(async () => {}, { ...f.scope, timeoutMs: 10 })).rejects.toThrow("busy or abandoned")
      expect((await fs.stat(path.join(f.scope.directory, "guard"))).isDirectory()).toBe(true)
    } finally { await fs.rm(f.root, { recursive: true, force: true }) }
  })

  it("keeps native shallow clone independent and prevents deleting a referenced source", async () => {
    const f = await fixture()
    const db = await lancedb.connect(f.database)
    let source: Awaited<ReturnType<typeof db.openTable>> | undefined
    let clone: typeof source
    try {
      source = await db.createTable("base", [{ id: 1, value: "common", vector: [1, 0] }, { id: 2, value: "replace", vector: [0, 1] }])
      const version = await source.version()
      clone = await withCloneGuard(async () => {
        await recordCloneDependency(f.address("base"), f.address("private"))
        return db.cloneTable("private", path.join(f.database, "base.lance"), { sourceVersion: version, isShallow: true })
      }, f.scope)
      await clone.delete("id = 2")
      await clone.add([{ id: 3, value: "dirty-private", vector: [.5, .5] }])
      const ids = async (table: NonNullable<typeof source>) => (await table.query().select(["id"]).toArray()).map(row => Number(row.id)).sort()
      expect(await ids(source)).toEqual([1, 2])
      expect(await ids(clone)).toEqual([1, 3])
      await expect(withCloneGuard(async () => {
        if ((await findCloneDependents(f.address("base"))).length) throw new Error("base pinned by clone")
        await db.dropTable("base")
      }, f.scope)).rejects.toThrow("pinned")
      expect(await ids(clone)).toEqual([1, 3])
      await withCloneGuard(async () => {
        await db.dropTable("private")
        await removeCloneDependency(f.address("private"))
        expect(await findCloneDependents(f.address("base"))).toEqual([])
        await db.dropTable("base")
      }, f.scope)
    } finally { clone?.close(); source?.close(); db.close(); await fs.rm(f.root, { recursive: true, force: true }) }
  })

  it("serializes real processes and refuses recovery after a guard holder exits abruptly", async () => {
    const f = await fixture()
    const worker = path.resolve("node_modules/.cache", `clone-guard-${randomUUID()}.mjs`)
    try {
      const modulePath = path.resolve("packages/core/src/semantic/clone-dependencies.ts")
      await fs.mkdir(path.dirname(worker), { recursive: true })
      await build({ stdin: { contents: `
        import fs from 'node:fs/promises';
        import path from 'node:path';
        import { withCloneGuard } from ${JSON.stringify(modulePath)};
        const [directory, events, name, mode] = process.argv.slice(2);
        await withCloneGuard(async () => {
          await fs.appendFile(events, name + ':enter\\n');
          if (mode === 'crash') process.exit(31);
          const handle = await fs.open(path.join(directory, 'active-writer'), 'wx');
          try { await new Promise(resolve => setTimeout(resolve, 40)); }
          finally { await handle.close(); await fs.unlink(path.join(directory, 'active-writer')); }
          await fs.appendFile(events, name + ':exit\\n');
        }, { directory });
      `, sourcefile: "clone-guard-worker.ts", resolveDir: process.cwd(), loader: "ts" }, outfile: worker, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent" })
      const events = path.join(f.root, "events")
      const env = { ...process.env, XDG_CONFIG_HOME: path.join(f.root, "config"), XDG_CACHE_HOME: path.join(f.root, "cache"), XDG_DATA_HOME: path.join(f.root, "data"), XDG_STATE_HOME: path.join(f.root, "state"), SENSEGREP_NETWORK_POLICY: "local-only" }
      const run = (name: string, mode = "normal") => new Promise<number | null>((resolve, reject) => {
        const child = spawn(process.execPath, [worker, f.scope.directory, events, name, mode], { env, stdio: ["ignore", "ignore", "pipe"] })
        let stderr = ""
        child.stderr.on("data", chunk => { stderr += chunk })
        child.once("error", reject)
        child.once("close", code => { if (code !== 0 && !(mode === "crash" && code === 31)) reject(new Error(`guard worker exited ${code}: ${stderr}`)); else resolve(code) })
      })
      expect(await Promise.all([run("alpha"), run("beta")])).toEqual([0, 0])
      const lines = (await fs.readFile(events, "utf8")).trim().split("\n")
      expect(lines.length).toBe(4)
      expect(lines[0].split(":")[0]).toBe(lines[1].split(":")[0])
      expect(lines[2].split(":")[0]).toBe(lines[3].split(":")[0])
      expect(lines.map(line => line.split(":")[1])).toEqual(["enter", "exit", "enter", "exit"])
      expect(await run("crashed", "crash")).toBe(31)
      await expect(withCloneGuard(async () => {}, { ...f.scope, timeoutMs: 10 })).rejects.toThrow("busy or abandoned")
      expect((await fs.stat(path.join(f.scope.directory, "guard"))).isDirectory()).toBe(true)
    } finally { await fs.rm(worker, { force: true }); await fs.rm(f.root, { recursive: true, force: true }) }
  }, 15_000)
})
