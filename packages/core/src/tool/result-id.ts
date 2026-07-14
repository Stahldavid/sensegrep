import path from "node:path"

export type ResultLocation = {
  file: string
  startLine: number
  endLine: number
  symbol?: string
}

const COMPACT_PREFIX = "r:"
const LEGACY_PREFIX = "symbol:"
const FIELD_SEPARATOR = "\0"

function normalizeFile(file: string): string {
  return file.replace(/\\/g, "/").replace(/^\.\//, "")
}

export function createResultId(location: ResultLocation): string {
  const payload = [
    normalizeFile(location.file),
    String(location.startLine),
    String(location.endLine),
    location.symbol ?? "",
  ].join(FIELD_SEPARATOR)
  return `${COMPACT_PREFIX}${Buffer.from(payload).toString("base64url")}`
}

function parseLocation(input: Record<string, unknown>, resultId: string): ResultLocation {
  if (typeof input.file !== "string" || !Number.isInteger(input.startLine) || !Number.isInteger(input.endLine)) {
    throw new Error(`Invalid result ID "${resultId}".`)
  }
  if (!input.file || Number(input.startLine) < 1 || Number(input.endLine) < Number(input.startLine)) {
    throw new Error(`Invalid result ID "${resultId}".`)
  }
  return {
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
  if (fields.length !== 4) throw new Error(`Invalid result ID "${resultId}".`)
  const [file, startLine, endLine, symbol] = fields
  return parseLocation({ file, startLine: Number(startLine), endLine: Number(endLine), symbol }, resultId)
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
  if (resultId.startsWith(COMPACT_PREFIX)) return decodeCompactResultId(resultId)
  if (resultId.startsWith(LEGACY_PREFIX)) return decodeLegacyResultId(resultId)
  throw new Error(`Invalid result ID "${resultId}".`)
}

export function resolveResultPath(rootDir: string, location: ResultLocation): string {
  const absolute = path.resolve(rootDir, location.file)
  const relative = path.relative(rootDir, absolute)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Result ID points outside the project root.")
  }
  return absolute
}
