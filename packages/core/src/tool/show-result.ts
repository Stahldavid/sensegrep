import fs from "node:fs/promises"
import { decodeResultId, resolveResultPath, type ResultLocation } from "./result-id.js"

export type ShowResultOptions = {
  rootDir: string
  resultId: string
  before?: number
  after?: number
}

export async function runShowResult(options: ShowResultOptions, target: ResultLocation = decodeResultId(options.resultId)) {
  const absolute = resolveResultPath(options.rootDir, target)
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
