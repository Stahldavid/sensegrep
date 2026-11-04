import fs from "node:fs/promises"
import path from "node:path"
import { CliUsageError } from "./cli-errors.js"
import { cliProfile } from "./cli-profile.js"

type Manifest = { repositoryId: string; universe: string; files: unknown[] }
type RepositoryCore = {
  registerRepository(root: string, repositoryId: string): Promise<void>
  readRepositoryId(root: string): Promise<string | undefined>
  Instance: { provide<T>(options: { directory: string; profile?: string; fn: () => Promise<T> }): Promise<T> }
  VectorStore: {
    readIndexMeta(root: string): Promise<{ sourceSnapshot?: { id: string; manifest: Manifest } } | null>
    releaseIndexView(root: string): Promise<{ released: boolean; retainedTables: number }>
    collectReleasedViews(root: string): Promise<{ views: number; retainedTables: number }>
  }
}

/** Register only an explicitly supplied identity; inspecting never creates one. */
export async function repositoryCommand(core: RepositoryCore, root: string, profile: string | undefined, positional: string[]) {
  const [action, ...args] = positional
  if (!["register", "status", "manifest", "release", "gc"].includes(action) || (action !== "register" && args.length)) {
    throw new CliUsageError("repository requires register <uuid>, status, manifest, release, or gc")
  }
  const canonical = await fs.realpath(root).catch((error: any) => {
    if (action === "release" && error?.code === "ENOENT") return path.resolve(root)
    throw error
  })
  if (action === "register") {
    if (args.length !== 1) throw new CliUsageError("repository register requires one lowercase repository UUID")
    await core.registerRepository(canonical, args[0])
    return { schemaVersion: 1, command: "repository register", status: "registered", root: canonical, repositoryId: args[0],
      note: "Existing indexes are not rebuilt; a manifest is produced on a subsequent index publication when all indexed files have verified source identities." }
  }
  const effectiveProfile = cliProfile(profile)
  if (action === "release") {
    const result = await core.Instance.provide({ directory: canonical, profile: effectiveProfile, fn: () => core.VectorStore.releaseIndexView(canonical) })
    return { schemaVersion: 1, command: "repository release", root: canonical, profile: effectiveProfile,
      status: result.released ? "released" : "view-unavailable", ...result }
  }
  const repositoryId = await core.readRepositoryId(canonical)
  if (action === "gc") {
    if (!repositoryId) throw new Error("Repository garbage collection requires an explicitly registered existing checkout")
    const result = await core.Instance.provide({ directory: canonical, profile: effectiveProfile, fn: () => core.VectorStore.collectReleasedViews(canonical) })
    return { schemaVersion: 1, command: "repository gc", status: "collected", root: canonical, profile: effectiveProfile, repositoryId, ...result }
  }
  const meta = await core.Instance.provide({ directory: canonical, profile: effectiveProfile, fn: () => core.VectorStore.readIndexMeta(canonical) })
  const snapshot = meta?.sourceSnapshot
  if (snapshot && (!repositoryId || snapshot.manifest.repositoryId !== repositoryId)) {
    throw new Error("Index manifest identity does not match this checkout's registered repository; inspect the index and registration before proceeding.")
  }
  return {
    schemaVersion: 1, command: `repository ${action}`, root: canonical, profile: effectiveProfile,
    repositoryId: repositoryId ?? null,
    status: !meta ? "index-unavailable" : !snapshot ? "manifest-unavailable" : "available",
    snapshot: snapshot ? { id: snapshot.id, universe: snapshot.manifest.universe, files: snapshot.manifest.files.length,
      ...(action === "manifest" ? { manifest: snapshot.manifest } : {}) } : null,
    ...(!snapshot ? { note: "No verified source manifest is available for this index. Registration alone does not build or modify an index." } : {}),
  }
}
