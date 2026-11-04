import { describe, expect, it } from "vitest"
import { createHash } from "node:crypto"
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createServer } from "node:http"
import { createSourceManifest, sourceSnapshotId } from "./source-manifest.js"
import { captureSourceBundle, captureIndexedSourceBundle, fetchSourceBundle, serveSourceBundle, validateSourceBundle, storeSourceBundle, readStoredSourceBundle, createPortableResultId, readPortableResult } from "./snapshot-bundle.js"
import { runShowResult } from "../tool/show-result.js"
import { registerRepository } from "../project/repository-identity.js"
import { Instance } from "../project/instance.js"
import { VectorStore } from "./lancedb.js"
import { writeSourceObject } from "./source-object-store.js"
import { getReplicaObject } from "./replica-source-store.js"

const repositoryId = "38cd09b0-ec0a-4cb6-a9f5-adb14334b68f"
const secret = "0123456789abcdef0123456789abcdef"
const hash = (s: string) => createHash("sha256").update(s).digest("hex")

describe("authorized source bundle", () => {
  it("captures only matching indexed content and transfers it through the real loopback protocol", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sensegrep-snapshot-"))
    try {
      await writeFile(path.join(root, "a.ts"), "const x = 1\n")
      const manifest = createSourceManifest(repositoryId, { "a.ts": { sourceSha256: hash("const x = 1\n"), sourceHashKind: "sha256-raw-v1" } })!
      const bundle = await captureSourceBundle(root, manifest)
      const { server, port } = await serveSourceBundle(bundle, secret)
      let objectRequests = 0
      server.on("request", req => { if (req.url?.startsWith("/v2/objects/")) objectRequests++ })
      try {
        const expected = { repositoryId, snapshotId: sourceSnapshotId(manifest) }
        const replicaDirectory = path.join(root, "destination")
        expect(await fetchSourceBundle(port, secret, expected, undefined, replicaDirectory)).toEqual(bundle)
        expect(objectRequests).toBe(1)
        const id = createPortableResultId(bundle, { file: "a.ts", startLine: 1, endLine: 1 })
        await expect(runShowResult({ rootDir: root, resultId: id })).rejects.toThrow("explicit resolution")
        const received = await fetchSourceBundle(port, secret, expected, undefined, replicaDirectory)
        expect(objectRequests).toBe(1)
        expect(readPortableResult(received, id, repositoryId).content).toBe("const x = 1")
        expect(() => readPortableResult(received, id, "00000000-0000-0000-0000-000000000000")).toThrow("identity")
        const artifact = await storeSourceBundle(path.join(root, "destination"), received, expected)
        expect(JSON.parse(await readFile(artifact, "utf8"))).not.toHaveProperty("files")
        expect(await readStoredSourceBundle(artifact, expected)).toEqual(bundle)
        await expect(fetchSourceBundle(port, "x".repeat(32), expected)).rejects.toThrow("401")
        await expect(fetchSourceBundle(port, secret, { ...expected, repositoryId: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow("mismatch")
        expect(() => validateSourceBundle({ ...bundle, files: [{ path: "a.ts", contentBase64: Buffer.from("changed").toString("base64") }] }, expected)).toThrow("content mismatch")
        await writeFile(path.join(root, "a.ts"), "changed")
        await expect(captureSourceBundle(root, manifest)).rejects.toThrow("changed")
      } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it("preserves BOM and CRLF bytes and rejects interrupted transfers", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sensegrep-snapshot-bytes-"))
    try {
      const bytes = Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0x0d, 0x0a])
      await writeFile(path.join(root, "a.ts"), bytes)
      const manifest = createSourceManifest(repositoryId, { "a.ts": { sourceSha256: createHash("sha256").update(bytes).digest("hex"), sourceHashKind: "sha256-raw-v1" } })!
      const bundle = await captureSourceBundle(root, manifest)
      expect(Buffer.from(bundle.files[0].contentBase64, "base64")).toEqual(bytes)
      const server = createServer((_req, res) => { res.writeHead(200, { "content-length": 100 }); res.write("{"); res.socket?.destroy() })
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
      try {
        const address = server.address()
        if (!address || typeof address === "string") throw new Error("listener unavailable")
        await expect(fetchSourceBundle(address.port, secret, { repositoryId, snapshotId: bundle.snapshotId })).rejects.toThrow()
      } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it("resumes v2 after an interrupted object without retransmitting verified cached objects", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sensegrep-snapshot-resume-"))
    const first = Buffer.from("first verified object\n"), second = Buffer.from("second object\n")
    const firstHash = createHash("sha256").update(first).digest("hex"), secondHash = createHash("sha256").update(second).digest("hex")
    const manifest = createSourceManifest(repositoryId, { "a.ts": { sourceSha256: firstHash, sourceHashKind: "sha256-raw-v1" }, "b.ts": { sourceSha256: secondHash, sourceHashKind: "sha256-raw-v1" } })!
    const snapshotId = sourceSnapshotId(manifest)
    let interrupt = true, firstRequests = 0, secondRequests = 0
    const server = createServer((req, res) => {
      if (req.headers.authorization !== `Bearer ${secret}`) { res.writeHead(401); res.end(); return }
      if (req.url === "/v2/manifest") { res.end(JSON.stringify({ protocol: 2, snapshotId, manifest })); return }
      if (req.url === `/v2/objects/${firstHash}`) { firstRequests++; res.end(first); return }
      if (req.url === `/v2/objects/${secondHash}`) {
        secondRequests++
        if (interrupt) { interrupt = false; res.writeHead(200, { "content-length": second.length }); res.write(second.subarray(0, 1)); res.socket?.destroy(); return }
        res.end(second); return
      }
      res.writeHead(404); res.end()
    })
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
    try {
      const address = server.address()
      if (!address || typeof address === "string") throw new Error("listener unavailable")
      const expected = { repositoryId, snapshotId }
      const destination = path.join(root, "replica")
      await expect(fetchSourceBundle(address.port, secret, expected, undefined, destination)).rejects.toThrow()
      expect(firstRequests).toBe(1); expect(secondRequests).toBe(1)
      expect(await getReplicaObject(destination, firstHash, repositoryId)).toEqual(first)
      expect(await getReplicaObject(destination, secondHash, repositoryId)).toBeUndefined()
      const resumed = await fetchSourceBundle(address.port, secret, expected, undefined, destination)
      expect(firstRequests).toBe(1); expect(secondRequests).toBe(2)
      expect(resumed.files.map(file => Buffer.from(file.contentBase64, "base64"))).toEqual([first, second])
      expect(resumed.snapshotId).toBe(snapshotId)
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
      await rm(root, { recursive: true, force: true })
    }
  })

  it("requires a registered manifest and an extant index generation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sensegrep-indexed-capture-"))
    try {
      await writeFile(path.join(root, "a.ts"), "a\n")
      await registerRepository(root, repositoryId)
      await Instance.provide({ directory: root, profile: "capture", fn: async () => {
        const staged = await VectorStore.createStagingCollection(root, 8)
        const meta = { version: 1, root, tableName: staged.tableName, embeddings: { provider: "test", dimension: 8 }, files: { "a.ts": { size: 2, mtimeMs: 0, sourceSha256: hash("a\n"), sourceHashKind: "sha256-raw-v1" } }, updatedAt: Date.now() }
        await VectorStore.writeIndexMeta(root, meta)
        expect((await captureIndexedSourceBundle(root)).manifest.files[0].path).toBe("a.ts")
        await writeSourceObject(VectorStore.getIndexStoragePath(root), Buffer.from("a\n"))
        await writeFile(path.join(root, "a.ts"), "new dirty content\n")
        expect(Buffer.from((await captureIndexedSourceBundle(root)).files[0].contentBase64, "base64").toString()).toBe("a\n")
        await VectorStore.dropCollectionTable(root, staged.tableName)
        await expect(captureIndexedSourceBundle(root)).rejects.toThrow("generation is unavailable")
      } })
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
