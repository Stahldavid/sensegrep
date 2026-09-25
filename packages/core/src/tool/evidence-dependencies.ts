import type { WorkingResult } from "./sensegrep-pipeline.js"
import { compareWorkingResults } from "./sensegrep-pipeline.js"
import { evidenceKey } from "./jev-coverage.js"

/** Preserve a bounded amount of verified supporting evidence already in scope.
 * Bundles must come from attachJevConstants (AST, freshness and path checks).
 * This never manufactures candidates or treats a dependency as proof of sufficiency.
 */
export function rankConstantDependencies(rows: WorkingResult[], anchors: WorkingResult[]) {
  const promoted = new Map<WorkingResult, WorkingResult>()
  for (const anchor of anchors.slice(0, 5)) {
    for (const dependency of anchor.bundleSources ?? []) {
      if (promoted.size >= 2) break
      const row = rows.find(r => r.file === dependency.file && r.metadata.symbolName === dependency.symbol
        && r.startLine === dependency.startLine && r.endLine === dependency.endLine && r !== anchor)
      if (!row || row.contentTruncated || row.content.length > 1200 || promoted.has(row)) continue
      const score = anchor.rerankScore ?? anchor.semanticScore
      const prior = row.rerankScore ?? row.semanticScore
      promoted.set(row, {...row, rerankScore:Math.max(prior, score * .85),
        requiredBy:[...new Set([...(row.requiredBy ?? []), evidenceKey(anchor)])],
        whyMatched:[...(row.whyMatched ?? []), `constant dependency: ${anchor.file}:${anchor.metadata.symbolName}`]})
    }
  }
  return rows.map(r => promoted.get(r) ?? r).sort(compareWorkingResults)
}
