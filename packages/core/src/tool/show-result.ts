import fs from "node:fs/promises"
import path from "node:path"

export type ShowResultOptions = {
  rootDir: string
  resultId: string
  before?: number
  after?: number
}

function decodeResultId(resultId: string): { file: string; startLine: number; endLine: number; symbol?: string } {
  if (!resultId.startsWith("symbol:")) throw new Error(`Invalid result ID "${resultId}".`)
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(Buffer.from(resultId.slice("symbol:".length), "base64url").toString("utf8"))
  } catch {
    throw new Error(`Invalid result ID "${resultId}".`)
  }
  if (typeof parsed.file !== "string" || !Number.isInteger(parsed.startLine) || !Number.isInteger(parsed.endLine)) {
    throw new Error(`Invalid result ID "${resultId}".`)
  }
  return {
    file: parsed.file,
    startLine: Number(parsed.startLine),
    endLine: Number(parsed.endLine),
    ...(typeof parsed.symbol === "string" ? { symbol: parsed.symbol } : {}),
  }
}

export async function runShowResult(options: ShowResultOptions) {
  const target = decodeResultId(options.resultId)
  const absolute = path.resolve(options.rootDir, target.file)
  const relative = path.relative(options.rootDir, absolute)
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Result ID points outside the project root.")
  const source = await fs.readFile(absolute, "utf8")
  const lines = source.split(/\r?\n/)
  const startLine = Math.max(1, target.startLine - (options.before ?? 0))
  const endLine = Math.min(lines.length, target.endLine + (options.after ?? 0))
  const content = lines.slice(startLine - 1, endLine).join("\n")
  const targetFresh = !target.symbol
    || new RegExp(`\\b${target.symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(content)
  const snippetIntegrity = targetFresh ? "complete" : "stale-location"

  return {
    schemaVersion: 1,
    command: "show",
    status: targetFresh ? "complete" : "stale-location",
    title: `${target.file}:${startLine}-${endLine}`,
    metadata: { targetFresh, freshnessScope: "target-location" },
    freshness: { scope: "target-location", targetFresh },
    index: { freshnessScope: "target-location", targetFresh, schemaCompatible: null },
    warnings: targetFresh ? [] : ["The indexed location is stale; reindex before relying on this expansion."],
    result: {
      resultId: options.resultId,
      file: target.file,
      symbol: target.symbol,
      startLine,
      endLine,
      content,
      snippetIntegrity,
    },
    output: content,
  }
}
