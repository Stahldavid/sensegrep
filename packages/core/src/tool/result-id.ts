import path from "node:path"

export type ResultLocation = {
  file: string
  startLine: number
  endLine: number
  symbol?: string
  sourceHash?: string
  snapshotId?: string
  repositoryId?: string
}

const COMPACT_PREFIX = "r:"
const LEGACY_PREFIX = "symbol:"
const PORTABLE_PREFIX = "r2:"
const FIELD_SEPARATOR = "\0"

function normalizeFile(file: string): string {
  return file.replace(/\\/g, "/").replace(/^\.\//, "")
}

export function createResultId(location: ResultLocation): string {
  if (location.repositoryId) {
    const checked = parseLocation(location, "portable")
    return `${PORTABLE_PREFIX}${Buffer.from(JSON.stringify(checked)).toString("base64url")}`
  }
  const payload = [
    normalizeFile(location.file),
    String(location.startLine),
    String(location.endLine),
    location.symbol ?? "",
    ...(location.sourceHash || location.snapshotId ? [location.sourceHash ?? "", location.snapshotId ?? ""] : []),
  ].join(FIELD_SEPARATOR)
  return `${COMPACT_PREFIX}${Buffer.from(payload).toString("base64url")}`
}

function parseLocation(input: Record<string, unknown>, resultId: string): ResultLocation {
  if (typeof input.file !== "string" || !Number.isSafeInteger(input.startLine) || !Number.isSafeInteger(input.endLine)) {
    throw new Error(`Invalid result ID "${resultId}".`)
  }
  if (!input.file || Number(input.startLine) < 1 || Number(input.endLine) < Number(input.startLine)) {
    throw new Error(`Invalid result ID "${resultId}".`)
  }
  if (input.sourceHash !== undefined && (typeof input.sourceHash !== "string" || !/^[a-f0-9]{64}$/.test(input.sourceHash))) throw new Error("Invalid source hash in result ID")
  if (input.snapshotId !== undefined && (typeof input.snapshotId !== "string" || input.snapshotId.length > 256)) throw new Error("Invalid snapshot in result ID")
  if (input.repositoryId !== undefined && (typeof input.repositoryId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(input.repositoryId) || typeof input.snapshotId !== "string" || !/^sha256:[a-f0-9]{64}$/.test(input.snapshotId) || !input.sourceHash)) throw new Error("Portable result ID requires repository, snapshot and content identities")
  return {
    ...(input.repositoryId ? { repositoryId: input.repositoryId as string } : {}),
    ...(input.sourceHash ? { sourceHash: input.sourceHash as string } : {}),
    ...(input.snapshotId ? { snapshotId: input.snapshotId as string } : {}),
    file: normalizeFile(input.file),
    startLine: Number(input.startLine),
    endLine: Number(input.endLine),
    ...(typeof input.symbol === "string" && input.symbol ? { symbol: input.symbol } : {}),
  }
}

function decodeCompactResultId(resultId: string): ResultLocation {
  let fields: string[]
  try {
    fields = Buffer.from(resultId.slice(COMPACT_PREFIX.length), "base64url").toString("utf8").split(FIELD_SEPARATOR)
  } catch {
    throw new Error(`Invalid result ID "${resultId}".`)
  }
  if (fields.length !== 4 && fields.length !== 6) throw new Error(`Invalid result ID "${resultId}".`)
  const [file, startLine, endLine, symbol, sourceHash, snapshotId] = fields
  return parseLocation({ file, startLine: Number(startLine), endLine: Number(endLine), symbol, sourceHash: sourceHash || undefined, snapshotId: snapshotId || undefined }, resultId)
}

function decodeLegacyResultId(resultId: string): ResultLocation {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(Buffer.from(resultId.slice(LEGACY_PREFIX.length), "base64url").toString("utf8"))
  } catch {
    throw new Error(`Invalid result ID "${resultId}".`)
  }
  return parseLocation(parsed, resultId)
}

export function decodeResultId(resultId: string): ResultLocation {
  if (resultId.length > 16_384) throw new Error("Result ID exceeds size limit")
  if (resultId.startsWith(COMPACT_PREFIX)) return decodeCompactResultId(resultId)
  if (resultId.startsWith(LEGACY_PREFIX)) return decodeLegacyResultId(resultId)
  if (resultId.startsWith(PORTABLE_PREFIX)) {
    try {
      const value = JSON.parse(Buffer.from(resultId.slice(PORTABLE_PREFIX.length), "base64url").toString("utf8"))
      const result = parseLocation(value, resultId)
      if (!result.repositoryId) throw new Error("missing repository identity")
      return result
    } catch { throw new Error("Invalid portable result ID") }
  }
  throw new Error(`Invalid result ID "${resultId}".`)
}

export function resolveResultPath(rootDir: string, location: ResultLocation): string {
  const absolute = path.resolve(rootDir, location.file)
  const relative = path.relative(rootDir, absolute)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Result ID points outside the project root.")
  }
  return absolute
}
