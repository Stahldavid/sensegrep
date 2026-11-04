import { describe, expect, it, vi } from "vitest"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { repositoryCommand } from "./repository-command.js"

const id = "11111111-1111-4111-8111-111111111111"

describe("repository CLI", () => {
  it("registers only the explicit identity without touching index metadata", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sensegrep-repo-cli-"))
    try {
      const core = { registerRepository: vi.fn(async () => {}), readRepositoryId: vi.fn(async () => undefined),
        Instance: { provide: vi.fn(async ({ fn }: { fn: () => Promise<any> }) => fn()) },
        VectorStore: { readIndexMeta: vi.fn(async () => null), releaseIndexView: vi.fn(async () => ({ released: false, retainedTables: 0 })), collectReleasedViews: vi.fn(async () => ({ views: 0, retainedTables: 0 })) } }
      const result = await repositoryCommand(core, root, undefined, ["register", id])
      expect(result).toMatchObject({ status: "registered", repositoryId: id })
      expect(core.registerRepository).toHaveBeenCalledWith(await realpath(root), id)
      expect(core.VectorStore.readIndexMeta).not.toHaveBeenCalled()
      await expect(repositoryCommand(core, root, undefined, ["register"])).rejects.toThrow(/requires one/)
      await expect(repositoryCommand(core, root, undefined, ["register", id, id])).rejects.toThrow(/requires one/)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it("exposes only verified indexed-file manifests for the requested profile", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sensegrep-repo-cli-"))
    try {
      const manifest = { repositoryId: id, universe: "indexed-files", files: [{ path: "a.ts", sha256: "a".repeat(64) }] }
      const core = { registerRepository: vi.fn(async () => {}), readRepositoryId: vi.fn(async () => id),
        Instance: { provide: vi.fn(async ({ fn }: { directory: string; profile?: string; fn: () => Promise<any> }) => fn()) },
        VectorStore: { readIndexMeta: vi.fn(async (): Promise<any> => ({ sourceSnapshot: { id: "sha256:abc", manifest } })), releaseIndexView: vi.fn(async () => ({ released: false, retainedTables: 0 })), collectReleasedViews: vi.fn(async () => ({ views: 0, retainedTables: 0 })) } }
      const status = await repositoryCommand(core, root, "blue", ["status"])
      expect(status).toMatchObject({ status: "available", profile: "blue", snapshot: { id: "sha256:abc", files: 1 } })
      expect(status).toMatchObject({ snapshot: { id: "sha256:abc", universe: "indexed-files", files: 1 } })
      expect(core.Instance.provide.mock.calls[0][0].profile).toBe("blue")
      const detail = await repositoryCommand(core, root, "blue", ["manifest"])
      expect(detail).toMatchObject({ snapshot: { manifest } })
      core.readRepositoryId.mockResolvedValueOnce("22222222-2222-4222-8222-222222222222")
      await expect(repositoryCommand(core, root, "blue", ["manifest"])).rejects.toThrow(/does not match/)
      core.VectorStore.readIndexMeta.mockResolvedValueOnce({})
      expect(await repositoryCommand(core, root, undefined, ["manifest"])).toMatchObject({ status: "manifest-unavailable", snapshot: null })
      core.VectorStore.readIndexMeta.mockResolvedValueOnce(null)
      expect(await repositoryCommand(core, root, undefined, ["status"])).toMatchObject({ status: "index-unavailable", snapshot: null })
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it("releases an explicitly selected view even after its checkout directory is removed", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sensegrep-repo-release-"))
    const canonical = await realpath(root)
    await rm(root, { recursive: true, force: true })
    const core = {
      registerRepository: vi.fn(async () => {}), readRepositoryId: vi.fn(async () => id),
      Instance: { provide: vi.fn(async ({ fn }: { directory: string; profile?: string; fn: () => Promise<any> }) => fn()) },
      VectorStore: { readIndexMeta: vi.fn(async () => null), releaseIndexView: vi.fn(async () => ({ released: true, retainedTables: 2 })), collectReleasedViews: vi.fn(async () => ({ views: 0, retainedTables: 0 })) },
    }
    const result = await repositoryCommand(core, canonical, "branch-b", ["release"])
    expect(result).toMatchObject({ status: "released", root: canonical, profile: "branch-b", released: true, retainedTables: 2 })
    expect(core.VectorStore.releaseIndexView).toHaveBeenCalledWith(canonical)
    expect(core.Instance.provide.mock.calls[0][0]).toMatchObject({ directory: canonical, profile: "branch-b" })
    expect(core.readRepositoryId).not.toHaveBeenCalled()
    expect(core.VectorStore.readIndexMeta).not.toHaveBeenCalled()
    core.VectorStore.releaseIndexView.mockResolvedValueOnce({ released: false, retainedTables: 0 })
    expect(await repositoryCommand(core, canonical, "branch-b", ["release"])).toMatchObject({ status: "view-unavailable", released: false })
    core.VectorStore.releaseIndexView.mockRejectedValueOnce(new Error("retained view is busy"))
    await expect(repositoryCommand(core, canonical, "branch-b", ["release"])).rejects.toThrow("retained view is busy")
    await expect(repositoryCommand(core, canonical, "branch-b", ["release", "unexpected"])).rejects.toThrow("repository requires")
  })

  it("collects released views only through an existing explicitly registered checkout and chosen profile", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sensegrep-repo-gc-"))
    try {
      const core = {
        registerRepository: vi.fn(async () => {}), readRepositoryId: vi.fn(async (): Promise<string | undefined> => id),
        Instance: { provide: vi.fn(async ({ fn }: { directory: string; profile?: string; fn: () => Promise<any> }) => fn()) },
        VectorStore: { readIndexMeta: vi.fn(async () => null), releaseIndexView: vi.fn(async () => ({ released: false, retainedTables: 0 })), collectReleasedViews: vi.fn(async () => ({ views: 2, retainedTables: 1 })) },
      }
      const result = await repositoryCommand(core, root, "blue", ["gc"])
      expect(result).toMatchObject({ command: "repository gc", status: "collected", repositoryId: id, profile: "blue", views: 2, retainedTables: 1 })
      expect(core.VectorStore.collectReleasedViews).toHaveBeenCalledWith(await realpath(root))
      expect(core.Instance.provide.mock.calls[0][0].profile).toBe("blue")
      expect(core.VectorStore.readIndexMeta).not.toHaveBeenCalled()
      core.readRepositoryId.mockResolvedValueOnce(undefined)
      await expect(repositoryCommand(core, root, "blue", ["gc"])).rejects.toThrow("explicitly registered")
      expect(core.VectorStore.collectReleasedViews).toHaveBeenCalledTimes(1)
      await expect(repositoryCommand(core, path.join(root, "missing"), "blue", ["gc"])).rejects.toMatchObject({ code: "ENOENT" })
      expect(core.VectorStore.collectReleasedViews).toHaveBeenCalledTimes(1)
      await expect(repositoryCommand(core, root, "blue", ["gc", "unexpected"])).rejects.toThrow("repository requires")
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})

it("persists a checkout identity through the real registration API in an isolated process", async () => {
  const { build } = await import("esbuild")
  const { spawn } = await import("node:child_process")
  const { randomUUID } = await import("node:crypto")
  const { mkdir } = await import("node:fs/promises")
  const root = await mkdtemp(path.join(os.tmpdir(), "sensegrep-repo-cli-integration-"))
  const bundle = path.resolve("node_modules/.cache", `repository-cli-${randomUUID()}.mjs`)
  try {
    await mkdir(path.dirname(bundle), { recursive: true })
    const entry = `import { repositoryCommand } from ${JSON.stringify(path.resolve("packages/cli/src/repository-command.ts"))};
import { registerRepository, readRepositoryId } from ${JSON.stringify(path.resolve("packages/core/src/project/repository-identity.ts"))};
const core = { registerRepository, readRepositoryId, Instance: { provide: ({fn, profile}) => { if (profile !== 'env-profile') throw Error('wrong profile'); return fn() } }, VectorStore: { readIndexMeta: async () => null } };
await repositoryCommand(core, process.argv[2], undefined, ['register', process.argv[3]]);
console.log(JSON.stringify(await repositoryCommand(core, process.argv[2], undefined, ['status'])));`
    await build({ stdin: { contents: entry, resolveDir: process.cwd(), sourcefile: "repository-cli-test.ts", loader: "ts" }, outfile: bundle, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent" })
    const child = spawn(process.execPath, [bundle, root, id], { env: { ...process.env, XDG_CONFIG_HOME: path.join(root, "config"), XDG_CACHE_HOME: path.join(root, "cache"), XDG_DATA_HOME: path.join(root, "data"), XDG_STATE_HOME: path.join(root, "state"), SENSEGREP_PROFILE: "env-profile", SENSEGREP_NETWORK_POLICY: "local-only" }, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = "", stderr = ""
    child.stdout!.on("data", chunk => { stdout += chunk })
    child.stderr!.on("data", chunk => { stderr += chunk })
    const exitCode = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve) })
    expect(stderr).toBe("")
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({ repositoryId: id, status: "index-unavailable", profile: "env-profile" })
  } finally { await rm(bundle, { force: true }); await rm(root, { recursive: true, force: true }) }
})
