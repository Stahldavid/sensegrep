import { EVIDENCE_POLICY } from './jev-policy.js'
import type { WorkingResult } from "./sensegrep-pipeline.js"
import { coverageSummary, evidenceKey, type EvidenceAspect } from "./jev-coverage.js"

/** Advisory flags select bounded deterministic lookups, never model-generated symbol names. */
export function planJevRecovery(rows: WorkingResult[], aspects: EvidenceAspect[], limit: number, packet?: {verdict:string; missingAspects:string[]; coverage?:Array<{gaps?:Array<{choice:string; probabilities:Record<string,number>} | undefined>}>}) {
  const missingAspects = coverageSummary(rows.slice(0, limit), aspects)
    .filter(a => a.status !== "supported").map(a => a.text)
  const eligible = rows.filter(r => !r.contentTruncated && ((r.jev?.evidence ?? 0) >= EVIDENCE_POLICY.admission ||
    (r.jev?.relevant ?? 0) >= EVIDENCE_POLICY.admission && Math.max(r.jev?.dimensions?.missing_helper ?? 0,
      r.jev?.dimensions?.missing_condition ?? 0,r.jev?.dimensions?.missing_configuration ?? 0) >= EVIDENCE_POLICY.recovery))
  const incomplete = packet && packet.verdict !== 'direct-evidence' && packet.verdict !== 'conflicting-evidence'
  const gaps=packet?.coverage?.flatMap(a=>a.gaps ?? []).filter(g=>g && (g.probabilities[g.choice] ?? 0)>=EVIDENCE_POLICY.sufficient).map(g=>g!.choice) ?? []
  const helpers = (gaps.length && !gaps.includes('missing_definition') && !gaps.includes('ambiguous') ? [] : eligible).filter(r => incomplete || missingAspects.length ||
    Math.max(r.jev?.dimensions?.missing_helper ?? 0, r.jev?.dimensions?.missing_condition ?? 0) >= EVIDENCE_POLICY.recovery).slice(0, 5)
  const configurations = (gaps.length && !gaps.includes('missing_value') && !gaps.includes('ambiguous') ? [] : eligible).filter(r => incomplete || (r.jev?.dimensions?.missing_configuration ?? 0) >= EVIDENCE_POLICY.recovery).slice(0, 5)
  return { missingAspects: packet?.missingAspects ?? missingAspects, helpers, configurations, actions: [
    ...(helpers.length ? ["resolve-existing-calls"] : []),
    ...(configurations.length ? ["resolve-referenced-literals"] : []),
  ] }
}

/** A recovered constant must be returned as evidence, not hidden judging-only context. */
export function recoveredConstants(bundled: WorkingResult[], known: WorkingResult[]) {
  const keys = new Set(known.map(evidenceKey))
  const result: WorkingResult[] = []
  for (const row of bundled) for (const constant of row.bundleSources ?? []) {
    const candidate: WorkingResult = { file: constant.file, startLine: constant.startLine, endLine: constant.endLine,
      content: constant.content, semanticScore: Math.min(.9, row.semanticScore),
      metadata: { symbolName: constant.symbol, symbolType: "variable", snippetIntegrity: "complete" }, retrievalSources: ["helper"], requiredBy:[evidenceKey(row)] }
    if (!keys.has(evidenceKey(candidate))) { keys.add(evidenceKey(candidate)); result.push(candidate) }
  }
  return result.slice(0, 4)
}
