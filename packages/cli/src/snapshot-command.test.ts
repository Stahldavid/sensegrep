import { describe, expect, it } from "vitest"
import { build } from "esbuild"
import { spawn, type ChildProcess } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import path from "node:path"
import os from "node:os"

const repo = "38cd09b0-ec0a-4cb6-a9f5-adb14334b68f"
const token = "secret-for-isolated-test-only-1234567890"

describe("snapshot CLI transport", () => {
  it("serves and fetches verified bytes in separate processes and rejects missing or incorrect credentials", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sensegrep-snapshot-cli-"))
    const bundle = path.resolve("node_modules/.cache", `snapshot-cli-${randomUUID()}.mjs`)
    let server: ChildProcess | undefined
    try {
      await mkdir(path.dirname(bundle), { recursive: true })
      await writeFile(path.join(root, "a.ts"), "const x = 1\n")
      const entry = `import { snapshotCommand } from ${JSON.stringify(path.resolve("packages/cli/src/snapshot-command.ts"))};
import { parseArgs } from ${JSON.stringify(path.resolve("packages/cli/src/args.ts"))};
import { captureSourceBundle, serveSourceBundle, fetchSourceBundle, storeSourceBundle, readStoredSourceBundle, createPortableResultId, readPortableResult } from ${JSON.stringify(path.resolve("packages/core/src/semantic/snapshot-bundle.ts"))};
import { createSourceManifest } from ${JSON.stringify(path.resolve("packages/core/src/semantic/source-manifest.ts"))};
import { decodeResultId } from ${JSON.stringify(path.resolve("packages/core/src/tool/result-id.ts"))};
import { pinReplicaSnapshot, unpinReplicaSnapshot, collectReplicaObjects } from ${JSON.stringify(path.resolve("packages/core/src/semantic/replica-source-store.ts"))};
import { createHash } from 'node:crypto';
const hash = createHash('sha256').update('const x = 1\\n').digest('hex');
const manifest = createSourceManifest(${JSON.stringify(repo)}, { 'a.ts': { sourceSha256: hash, sourceHashKind: 'sha256-raw-v1' } });
const core = { Instance: { provide: ({fn, profile}) => { if (profile !== 'env-profile') throw Error('wrong profile'); return fn() } }, captureIndexedSourceBundle: root => captureSourceBundle(root, manifest), serveSourceBundle, fetchSourceBundle, storeSourceBundle, readStoredSourceBundle, createPortableResultId, readPortableResult, decodeResultId, pinReplicaSnapshot, unpinReplicaSnapshot, collectReplicaObjects };
const {flags, positional} = parseArgs(process.argv.slice(2));
try { await snapshotCommand(core, process.cwd(), flags, positional) } catch (error) { process.stderr.write(String(error.message)); process.exitCode = 1 }`
      await build({ stdin: { contents: entry, resolveDir: process.cwd(), sourcefile: "snapshot-cli-worker.ts", loader: "ts" }, outfile: bundle, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent" })
      const env = { ...process.env, XDG_CONFIG_HOME: path.join(root, "config"), XDG_CACHE_HOME: path.join(root, "cache"), XDG_DATA_HOME: path.join(root, "data"), XDG_STATE_HOME: path.join(root, "state"), SENSEGREP_PROFILE: "env-profile", SENSEGREP_NETWORK_POLICY: "local-only", SENSEGREP_SNAPSHOT_TOKEN: token }
      server = spawn(process.execPath, [bundle, "serve", "--root", root], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] })
      const info = await new Promise<any>((resolve, reject) => {
        let out = "", err = ""
        server!.stderr!.on("data", chunk => { err += chunk })
        server!.stdout!.on("data", chunk => { out += chunk; if (out.includes("\n")) { try { resolve(JSON.parse(out)) } catch (error) { reject(error) } } })
        server!.once("error", reject)
        server!.once("exit", code => reject(new Error(`server exited ${code}: ${err}`)))
      })
      expect(info).toMatchObject({ status: "listening", host: "127.0.0.1", profile: "env-profile", repositoryId: repo, universe: "indexed-files" })
      expect(JSON.stringify(info)).not.toContain(token)
      const args = [bundle, "fetch", "--port", String(info.port), "--repository", repo, "--snapshot", info.snapshotId, "--destination", path.join(root, "received")]
      const run = (environment: NodeJS.ProcessEnv, argv = args) => new Promise<{ code: number | null; out: string; err: string }>((resolve, reject) => {
        const child = spawn(process.execPath, argv, { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"] })
        let out = "", err = ""
        child.stdout.on("data", chunk => { out += chunk }); child.stderr.on("data", chunk => { err += chunk })
        child.once("error", reject); child.once("close", code => resolve({ code, out, err }))
      })
      const missing = { ...env }; delete (missing as Partial<typeof env>).SENSEGREP_SNAPSHOT_TOKEN
      const without = await run(missing)
      expect(without.code).not.toBe(0); expect(without.err).toMatch(/SENSEGREP_SNAPSHOT_TOKEN/)
      const wrong = await run({ ...env, SENSEGREP_SNAPSHOT_TOKEN: "x".repeat(32) })
      expect(wrong.code).not.toBe(0); expect(wrong.err).toMatch(/401/)
      const fetched = await run(env)
      expect(fetched.code).toBe(0); expect(fetched.err).toBe("")
      expect(fetched.out).not.toContain(token)
      const result = JSON.parse(fetched.out)
      expect(result).toMatchObject({ status: "stored", repositoryId: repo, snapshotId: info.snapshotId, indexActivated: false })
      const saved = JSON.parse(await readFile(result.artifact, "utf8"))
      expect(saved.storage).toBe("source-replica-v1")
      expect(saved).not.toHaveProperty("files")
      expect(await readFile(path.join(path.dirname(result.artifact), ".replica-objects", "sha256", saved.manifest.files[0].sha256), "utf8")).toBe("const x = 1\n")
      const reference = await run(missing, [bundle, "reference", "--artifact", result.artifact, "--repository", repo, "--snapshot", info.snapshotId, "--file", "a.ts", "--start", "1", "--end", "1"])
      expect(reference.code).toBe(0)
      const ref = JSON.parse(reference.out)
      expect(ref.note).toMatch(/not evidence of a symbol or search result/)
      const shown = await run(missing, [bundle, "show", "--artifact", result.artifact, "--repository", repo, "--result", ref.resultId])
      expect(shown.code).toBe(0)
      expect(JSON.parse(shown.out)).toMatchObject({ status: "available", content: "const x = 1", repositoryId: repo, snapshotId: info.snapshotId })
      const mismatch = await run(missing, [bundle, "show", "--artifact", result.artifact, "--repository", "00000000-0000-4000-8000-000000000000", "--result", ref.resultId])
      expect(mismatch.code).not.toBe(0)
      const pinArgs = ["--artifact", result.artifact, "--repository", repo, "--snapshot", info.snapshotId]
      const pinned = await run(missing, [bundle, "pin", ...pinArgs])
      expect(pinned.code).toBe(0)
      expect(JSON.parse(pinned.out)).toMatchObject({ status: "pinned", repositoryId: repo, snapshotId: info.snapshotId })
      const pinFile = path.join(path.dirname(result.artifact), ".replica-pins", `${info.snapshotId.slice(7)}.json`)
      expect(JSON.parse(await readFile(pinFile, "utf8"))).toMatchObject({ snapshotId: info.snapshotId })
      const badGc = await run(missing, [bundle, "gc", "--destination", path.dirname(result.artifact), "--repository", "00000000-0000-4000-8000-000000000000"])
      expect(badGc.code).not.toBe(0); expect(badGc.err).toMatch(/identity mismatch/)
      const pinnedGc = await run(missing, [bundle, "gc", "--destination", path.dirname(result.artifact), "--repository", repo, "--max-bytes", "1"])
      expect(pinnedGc.code).not.toBe(0); expect(pinnedGc.err).toMatch(/budget exceeded/)
      expect((await run(missing, [bundle, "show", "--artifact", result.artifact, "--repository", repo, "--result", ref.resultId])).code).toBe(0)
      const unpinned = await run(missing, [bundle, "unpin", ...pinArgs])
      expect(unpinned.code).toBe(0)
      expect(JSON.parse(unpinned.out)).toMatchObject({ status: "unpinned", snapshotId: info.snapshotId })
      await expect(readFile(pinFile, "utf8")).rejects.toMatchObject({ code: "ENOENT" })
      const collected = await run(missing, [bundle, "gc", "--destination", path.dirname(result.artifact), "--repository", repo, "--retain-snapshots", "1"])
      expect(collected.code).toBe(0)
      expect(JSON.parse(collected.out)).toMatchObject({ status: "collected", repositoryId: repo, removedSnapshots: 0, removedObjects: 0 })
    } finally {
      if (server && server.exitCode === null && server.signalCode === null) { const done = new Promise(resolve => server!.once("exit", resolve)); server.kill("SIGTERM"); await done }
      await rm(bundle, { force: true }); await rm(root, { recursive: true, force: true })
    }
  }, 15_000)
})
