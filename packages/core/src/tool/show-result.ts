import { decodeResultId, type ResultLocation } from "./result-id.js"
import { readProjectSource, validateSourceRange, sourceContentHash } from "../file/source-reader.js"

export type ShowResultOptions = {
  rootDir: string
  resultId: string
  before?: number
  after?: number
  maxSourceBytes?: number
  signal?: AbortSignal
}

export async function runShowResult(options: ShowResultOptions, target: ResultLocation = decodeResultId(options.resultId)) {
  if (target.repositoryId) throw new Error("Portable result IDs require explicit resolution against their verified source bundle.")
  const { lines } = await readProjectSource(options.rootDir, target.file, { maxBytes: options.maxSourceBytes, signal: options.signal })
  validateSourceRange(lines, target.startLine, target.endLine)
  const targetContent = lines.slice(target.startLine - 1, target.endLine).join("\n")
  const targetFresh = target.sourceHash ? sourceContentHash(targetContent) === target.sourceHash : null
  const startLine = Math.max(1, target.startLine - (options.before ?? 0))
  const endLine = Math.min(lines.length, target.endLine + (options.after ?? 0))
  const content = lines.slice(startLine - 1, endLine).join("\n")
  const snippetIntegrity = targetFresh === false ? "stale-location" : targetFresh === null ? "unknown" : "complete"
  return {
    schemaVersion: 1,
    command: "show",
    status: targetFresh === false ? "stale-location" : "complete",
    title: `${target.file}:${startLine}-${endLine}`,
    metadata: { targetFresh, freshnessScope: "target-location" },
    freshness: { scope: "target-location", targetFresh },
    index: { freshnessScope: "target-location", targetFresh, schemaCompatible: null },
    warnings: targetFresh === false ? ["The source has changed; refresh search before relying on this expansion."]
      : targetFresh === null ? ["Source identity was not recorded by this result ID; freshness is unknown."] : [],
    result: { resultId: options.resultId, file: target.file, symbol: target.symbol, startLine, endLine, content, snippetIntegrity },
    output: content,
  }
}
