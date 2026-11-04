import { createHash } from "node:crypto"

/** Identity of the indexed file universe, not a complete repository snapshot. */
export type SourceManifest = {
  version: 1
  repositoryId: string
  universe: "indexed-files"
  files: Array<{ path: string; sha256: string }>
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const digest = /^[0-9a-f]{64}$/

export function validateRepositoryId(id: string): void {
  if (!uuid.test(id)) throw new Error("Repository identity must be a lowercase UUID")
}

function validPath(value: string): boolean {
  return value.length > 0 && !value.includes("\\") && !value.includes("\0") &&
    !value.startsWith("/") && !/^[A-Za-z]:/.test(value) &&
    value.split("/").every(part => part !== "" && part !== "." && part !== "..")
}

/** Validate the wire form, requiring canonical ordering and no duplicate paths. */
export function validateSourceManifest(value: unknown): SourceManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid source manifest")
  const object = value as Record<string, unknown>
  if (Object.keys(object).sort().join(",") !== "files,repositoryId,universe,version" ||
      object.version !== 1 || object.universe !== "indexed-files" || typeof object.repositoryId !== "string" || !Array.isArray(object.files)) {
    throw new Error("Invalid source manifest")
  }
  validateRepositoryId(object.repositoryId)
  const files: SourceManifest["files"] = []
  for (const entry of object.files) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Invalid source manifest entry")
    const file = entry as Record<string, unknown>
    if (Object.keys(file).sort().join(",") !== "path,sha256" || typeof file.path !== "string" || !validPath(file.path) || typeof file.sha256 !== "string" || !digest.test(file.sha256)) throw new Error("Invalid source manifest entry")
    if (files.length && files[files.length - 1].path >= file.path) throw new Error("Source manifest paths must be unique and sorted")
    files.push({ path: file.path, sha256: file.sha256 })
  }
  return { version: 1, repositoryId: object.repositoryId, universe: "indexed-files", files }
}

export function createSourceManifest(repositoryId: string, files: Record<string, { sourceSha256?: string; sourceHashKind?: string }>): SourceManifest | undefined {
  validateRepositoryId(repositoryId)
  const entries = Object.entries(files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  if (entries.some(([file, stat]) => !validPath(file) || stat.sourceHashKind !== "sha256-raw-v1" || !stat.sourceSha256 || !digest.test(stat.sourceSha256))) return undefined
  return validateSourceManifest({ version: 1, repositoryId, universe: "indexed-files", files: entries.map(([file, stat]) => ({ path: file, sha256: stat.sourceSha256 })) })
}

export function sourceSnapshotId(manifest: SourceManifest): string {
  const canonical = validateSourceManifest(manifest)
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical)).digest("hex")}`
}
