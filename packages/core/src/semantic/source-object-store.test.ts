import { describe, expect, it } from "vitest"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, readdir, rm, writeFile, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { readSourceObject, writeSourceObject } from "./source-object-store.js"

describe("per-index historical source objects", () => {
  it("atomically deduplicates concurrent publications and retains exact bytes independently of the live file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sensegrep-source-cas-"))
    try {
      const bytes = Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0x0d, 0x0a])
      const sha = createHash("sha256").update(bytes).digest("hex")
      expect(await Promise.all(Array.from({ length: 12 }, () => writeSourceObject(root, bytes, { expectedSha256: sha })))).toEqual(Array(12).fill(sha))
      expect(await readSourceObject(root, sha)).toEqual(bytes)
      expect(await readdir(path.join(root, ".source-objects", "sha256"))).toEqual([sha])
      await expect(readSourceObject(path.join(root, "other-profile"), sha)).rejects.toMatchObject({ code: "ENOENT" })
      await expect(readSourceObject(root, sha, { maxBytes: 1 })).rejects.toMatchObject({ code: "source-object-too-large" })
      await expect(writeSourceObject(root, bytes, { expectedSha256: "0".repeat(64) })).rejects.toMatchObject({ code: "source-object-corrupt" })
      const cancelled = new AbortController(); cancelled.abort()
      await expect(writeSourceObject(root, bytes, { signal: cancelled.signal })).rejects.toThrow()
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it("rejects corruption and unsafe existing objects rather than replacing them", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sensegrep-source-corrupt-"))
    try {
      const bytes = Buffer.from("original"), sha = createHash("sha256").update(bytes).digest("hex")
      await writeSourceObject(root, bytes)
      const filename = path.join(root, ".source-objects", "sha256", sha)
      await writeFile(filename, "corrupt!")
      await expect(readSourceObject(root, sha)).rejects.toMatchObject({ code: "source-object-corrupt" })
      await expect(writeSourceObject(root, bytes)).rejects.toMatchObject({ code: "source-object-corrupt" })
      expect(await readFile(filename, "utf8")).toBe("corrupt!")
      if (process.platform !== "win32") {
        await rm(filename)
        await writeFile(path.join(root, "elsewhere"), bytes)
        await symlink(path.join(root, "elsewhere"), filename)
        await expect(readSourceObject(root, sha)).rejects.toMatchObject({ code: "unsafe-source-object" })
      }
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
