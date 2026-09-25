import type { WorkingResult } from "./sensegrep-pipeline.js"
import { EVIDENCE_POLICY } from './jev-policy.js'

export type EvidenceAspect = { id: string; text: string; origin: "query" | "caller"; queryMode?: "open-question" }
export type EvidenceRelation = {
  caller: string; file: string; line: number; target: string; kind: "call" | "scheduled-call" | "reference"
  callsite: string; callerSignature: string; resolved: true
  callerContent?: string; callerTruncated?: boolean
}
export const evidenceKey = (r: WorkingResult) => `${r.file}:${r.startLine}:${r.endLine}:${r.metadata.symbolName ?? ""}`

/** Relations prove a call, never that its implementation answers the query. */
export function linkedEvidence(row: WorkingResult, selected: WorkingResult[]) {
  return selected.some(s => row.requiredBy?.includes(evidenceKey(s))
    || row.evidenceRelations?.some(e => e.resolved && e.caller === evidenceKey(s)))
}

export function uncertainDependency(row: WorkingResult, selected: WorkingResult[]) {
  if(row.contentTruncated || !linkedEvidence(row,selected)) return false
  // A resolved use is structural, not proof that the value answers this query.
  const necessity=row.jev?.dimensions?.dependency
  if(necessity!==undefined) return necessity>=EVIDENCE_POLICY.admission
  return Boolean(row.requiredBy?.length && (!row.jev || row.jev.category==='unassessed')) || (row.jev?.evidence ?? 0)>=EVIDENCE_POLICY.admission
}

/** Relative scores cannot establish absolute eligibility, especially on partial source. */
export function hasConcreteEvidence(row: WorkingResult): boolean {
  return !row.contentTruncated && row.jev?.category !== "unassessed" && row.jev?.category !== "weak"
    && Math.max(row.jev?.evidence ?? 0, row.jev?.contradiction ?? 0) >= EVIDENCE_POLICY.admission
}

export function evidenceShortlist(rows: WorkingResult[], count: number, priority: WorkingResult[] = []) {
  count = Math.max(0, Math.floor(count))
  const byKey = new Map(rows.map(r => [evidenceKey(r), r]))
  const anchors = [...new Set(priority.map(r => byKey.get(evidenceKey(r))).filter((r): r is WorkingResult => Boolean(r)))].slice(0, count)
  const parentRank = new Map(rows.map((r,i) => [evidenceKey(r),i]))
  const rank = (r: WorkingResult) => Math.min(...[...(r.requiredBy ?? []), ...(r.evidenceRelations ?? []).map(e=>e.caller)].map(k=>parentRank.get(k) ?? rows.length), rows.length)
  const helpers = rows.filter(r => r.jevOnly || r.evidenceRelations?.length || r.requiredBy?.length)
    .sort((a,b) => rank(a)-rank(b))
  const reserved = new Set<WorkingResult>([...new Set([...helpers, ...rows.filter(r => r.retrievalSources?.includes('helper'))])].slice(0, Math.min(8, Math.floor(count / 2))))
  for (const source of ["lexical", "vector"] as const) {
    const match = rows.find(r => r.retrievalSources?.includes(source))
    if (match && reserved.size < Math.floor(count / 2)) reserved.add(match)
  }
  const selected = new Set([...rows.filter(r => !reserved.has(r)).slice(0, count - reserved.size), ...reserved])
  const leaders = new Set([rows[0], ...["lexical", "vector"].map(source => rows.find(r => r.retrievalSources?.includes(source as 'lexical' | 'vector')))])
  // Minimal intervention: preserve the established shortlist, replacing its least
  // preferred non-anchor only when an actual local context source was omitted.
  for (const anchor of anchors) {
    if (selected.has(anchor)) continue
    const replaceable = [...rows].reverse().filter(r => selected.has(r) && !anchors.includes(r) && !leaders.has(r))
    const victim = replaceable.find(r => !reserved.has(r)) ?? replaceable[0]
    if (!victim) continue
    selected.delete(victim); selected.add(anchor)
  }

  return rows.filter(r => selected.has(r)) // Retain original rank as the local RRF signal.
}

/** No invented requirements: explicit caller facets or literal clauses from the query. */
export function evidenceAspects(query: string, explicit?: string[]): EvidenceAspect[] {
  const clauses = explicit ?? query.split(/\s*(?:;|\n)\s*/u).filter(Boolean)
  const texts = [...new Set(clauses.map(s => s.trim()).filter(Boolean))]
  // Unsplittable/long queries remain a single requirement, not a guessed checklist.
  const bounded = !explicit && (texts.length > 6 || texts.some(s => s.length < 8)) ? [query] : texts
  return bounded.slice(0, 6).map((text, i) => ({ id: `a${i}`, text, origin: explicit ? "caller" : "query" }))
}

export function coverageSummary(rows: WorkingResult[], aspects: EvidenceAspect[]) {
  return aspects.map(aspect => {
    const support = rows.filter(r => hasConcreteEvidence(r) && (r.jev?.aspects?.[aspect.id] ?? 0) >= EVIDENCE_POLICY.admission)
    return { ...aspect, status: support.length ? "supported" : "not-found-in-selected-evidence", completeness: "not-assessed" as const,
      evidence: support.map(evidenceKey), strength: Math.max(0, ...support.map(r => r.jev?.aspects?.[aspect.id] ?? 0)) }
  })
}

/** Retrieval utility is not completeness. Independent probabilities cannot establish redundancy. */
export function selectEvidenceCoverage(rows: WorkingResult[], aspects: EvidenceAspect[], maxTokens: number | undefined,
  limit: number, tokens: (r: WorkingResult) => number, seed: WorkingResult[] = []) {
  const selected: WorkingResult[] = [], remaining = rows.filter(r => !r.contentTruncated)
  const covered: Record<string, number> = {}
  let used = 0
  // Recovery adds evidence; it must not silently replace the packet it inspected.
  for (const row of seed) {
    if (row.contentTruncated || selected.length >= limit || used + tokens(row) > (maxTokens ?? Infinity)) continue
    if (selected.some(s => evidenceKey(s) === evidenceKey(row))) continue
    selected.push(row); used += tokens(row)
    const index = remaining.findIndex(r => evidenceKey(r) === evidenceKey(row))
    if (index >= 0) remaining.splice(index, 1)
    if (hasConcreteEvidence(row)) for (const aspect of aspects)
      covered[aspect.id] = Math.max(covered[aspect.id] ?? 0, row.jev?.aspects?.[aspect.id] ?? 0)
  }
  while (remaining.length && selected.length < limit) {
    const candidates = remaining.filter(r => (hasConcreteEvidence(r) || uncertainDependency(r, selected)) && used + tokens(r) <= (maxTokens ?? Infinity))
    if (!candidates.length) break
    const utility = (r: WorkingResult) => {
      const newRequirements = aspects.filter(a => (covered[a.id] ?? 0)<EVIDENCE_POLICY.admission && (r.jev?.aspects?.[a.id] ?? 0)>=EVIDENCE_POLICY.admission).length / Math.max(1,aspects.length)
      const rank = 1 / (1 + rows.indexOf(r) / 10)
      const overlaps = selected.some(s => s.file === r.file && s.startLine <= r.endLine && r.startLine <= s.endLine)
      const linked = linkedEvidence(r, selected)
      if(selected.some(s=>s.content.trim()===r.content.trim())) return -1
      return rank * 0.3 + newRequirements * 0.6 + (linked ? 0.1 : 0) - (overlaps ? 1 : 0)
        - Math.min(0.1, tokens(r) / Math.max(1, maxTokens ?? 12000) * 0.1)
    }
    if (selected.length) candidates.sort((a,b) => utility(b) - utility(a))
    const next = candidates[0]
    if (selected.length && utility(next) <= 0) break
    selected.push(next); used += tokens(next); remaining.splice(remaining.indexOf(next),1)
    // Pack directed complements immediately, before another independent anchor
    // consumes their space. Structural constants do not need standalone relevance.
    const dependencies = remaining.filter(r => uncertainDependency(r, [next]))
      .sort((a,b) => Number(!!b.requiredBy?.length) - Number(!!a.requiredBy?.length)
        || (b.jev?.dimensions?.dependency ?? b.jev?.evidence ?? 0) - (a.jev?.dimensions?.dependency ?? a.jev?.evidence ?? 0)
        || tokens(a)-tokens(b))
    for (const dependency of dependencies) {
      if (selected.length >= limit || used + tokens(dependency) > (maxTokens ?? Infinity)) continue
      if (selected.some(s => s.file === dependency.file && s.startLine <= dependency.endLine && dependency.startLine <= s.endLine)) continue
      selected.push(dependency); used += tokens(dependency); remaining.splice(remaining.indexOf(dependency),1)
    }
    for (const row of selected) if (hasConcreteEvidence(row) || uncertainDependency(row,selected)) {
      for (const aspect of aspects) covered[aspect.id] = Math.max(covered[aspect.id] ?? 0, row.jev?.aspects?.[aspect.id] ?? 0)
    }
  }
  return { results: selected, estimatedTokens: used }
}

/** Preserve bounded local anchors and resolved complements even in nonempty packets.
 * Selection is advisory: retained uncertainty never establishes sufficiency.
 * All inputs have already passed scope/diversity constraints. */
export function repairEvidencePacket(selected: WorkingResult[], baseline: WorkingResult[], pool: WorkingResult[],
  maxTokens: number | undefined, limit: number, tokens: (r: WorkingResult) => number) {
  const result = [...selected], protectedKeys = new Set<string>()
  let used = result.reduce((n,r) => n + tokens(r), 0), added = 0
  const anchors = baseline.filter(r => !r.contentTruncated).slice(0, 2)
  for (const r of anchors) protectedKeys.add(evidenceKey(r))
  const demands = [...pool.filter(r => uncertainDependency(r, selected)), ...anchors,
    ...pool.filter(r => uncertainDependency(r, anchors)), ...baseline]
  for (const parent of selected) if (demands.some(dep => linkedEvidence(dep, [parent]))) protectedKeys.add(evidenceKey(parent))
  for (const row of demands) {
    const key = evidenceKey(row)
    if (result.some(r => evidenceKey(r) === key) || row.contentTruncated
      || row.jev && row.jev.evidence < EVIDENCE_POLICY.uncertaintyLow && row.jev.relevant < EVIDENCE_POLICY.uncertaintyLow) continue
    if (added >= 3 || tokens(row) > (maxTokens ?? Infinity)) continue
    if (result.some(r => r.file === row.file && r.startLine <= row.endLine && row.startLine <= r.endLine)) continue
    if (result.length >= limit || used + tokens(row) > (maxTokens ?? Infinity)) {
      const victim = [...result].reverse().find(r => !protectedKeys.has(evidenceKey(r))
        && !linkedEvidence(r, anchors) && used - tokens(r) + tokens(row) <= (maxTokens ?? Infinity))
      if (!victim) continue
      result.splice(result.indexOf(victim), 1); used -= tokens(victim)
    }
    result.push(row); used += tokens(row); added++; protectedKeys.add(key)
  }
  return { results: result, estimatedTokens: used, added }
}

/** Source-free trace lets evaluation locate the stage where a labelled symbol disappeared. */
export function candidateTrace(stages: Record<string, WorkingResult[]>) {
  return Object.fromEntries(Object.entries(stages).map(([stage, rows]) => [stage, {
    count: rows.length, candidates: rows.map(r => ({ key: evidenceKey(r), file: r.file, symbol: r.metadata.symbolName,
      sources: r.retrievalSources ?? [], localScore: r.jev?.localScore ?? r.rerankScore ?? r.semanticScore,
      modelScore: r.jev?.modelScore, usefulMass: r.jev?.usefulMass, directMass: r.jev?.directMass, aspects: r.jev?.aspects, dimensions: r.jev?.dimensions,
      confidence: r.jev?.relevance?.confidence, relevance: r.jev?.relevance, contradiction: r.jev?.contradiction })),
  }]))
}

/** Deterministic exclusion explanations. No source or provider text is emitted. */
export function selectionDecisions(pool: WorkingResult[], selected: WorkingResult[], maxTokens: number | undefined,
  limit: number, tokens: (r: WorkingResult) => number) {
  const keys = new Set(selected.map(evidenceKey)), used = selected.reduce((n,r) => n+tokens(r),0)
  return pool.map(row => ({key:evidenceKey(row), reason:keys.has(evidenceKey(row)) ? "selected"
    : row.contentTruncated ? "incomplete-source"
    : !hasConcreteEvidence(row) && !uncertainDependency(row,selected) ? row.jev ? "no-usable-evidence" : "not-evaluated"
    : selected.some(s=>s.file===row.file && s.startLine<=row.endLine && row.startLine<=s.endLine) ? "overlapping-source"
    : used+tokens(row)>(maxTokens ?? Infinity) ? "token-budget"
    : selected.length>=limit ? "result-limit" : "lower-contribution"}))
}

/** Conditional contributions were judged against this exact selected packet.
 * Append only: removing an anchor would invalidate that conditional judgment. */
export function appendContributions(selected: WorkingResult[], judged: WorkingResult[], maxTokens: number | undefined,
  limit:number, tokens:(r:WorkingResult)=>number) {
  const results=[...selected]
  let estimatedTokens=results.reduce((n,r)=>n+tokens(r),0)
  for (const row of judged) {
    if (row.contentTruncated || (row.jev?.contribution ?? 0)< EVIDENCE_POLICY.admission || results.length>=limit
      || estimatedTokens+tokens(row)>(maxTokens ?? Infinity)) continue
    if (results.some(s=>s.file===row.file && s.startLine<=row.endLine && row.startLine<=s.endLine)) continue
    results.push(row);estimatedTokens+=tokens(row)
    // Another addition changes the conditioning set: at most one per cycle.
    break
  }
  return {results,estimatedTokens}
}

export function contributionShortlist(pool:WorkingResult[], selected:WorkingResult[]) {
  const keys=new Set(selected.map(evidenceKey))
  // Evidence and topic relevance are independent questions. Do not veto a
  // concrete implementation because the topic-only judgment disagrees.
  return pool.filter(r=>!keys.has(evidenceKey(r)) && !r.contentTruncated
    && Math.max(r.jev?.relevant ?? 0,r.jev?.evidence ?? 0,r.jev?.contradiction ?? 0)>= EVIDENCE_POLICY.admission).slice(0,4)
}

/** A newly admitted implementation needs the same literal-bundle guarantees as
 * the initial anchor. Inputs must be produced by source-verified AST recovery. */
export function appendReferencedConstants(selected:WorkingResult[], constants:WorkingResult[], maxTokens:number | undefined,
  limit:number, tokens:(r:WorkingResult)=>number) {
  const results=[...selected]
  let estimatedTokens=results.reduce((n,r)=>n+tokens(r),0)
  for (const row of constants) {
    if (!row.requiredBy?.length || !linkedEvidence(row,selected) || row.contentTruncated
      || results.length>=limit || estimatedTokens+tokens(row)>(maxTokens ?? Infinity)) continue
    if (results.some(s=>s.file===row.file && s.startLine<=row.endLine && row.startLine<=s.endLine)) continue
    results.push(row);estimatedTokens+=tokens(row)
  }
  return {results,estimatedTokens}
}
