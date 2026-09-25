import { EVIDENCE_POLICY } from './jev-policy.js'
import type { WorkingResult } from './sensegrep-pipeline.js'
import { evidenceKey } from './jev-coverage.js'

type BeamOptions = { depth:number; width:number; maxCandidates:number; deadline:number; signal?:AbortSignal }
/** Bounded traversal of resolved call edges. Scores order exploration, not joint probabilities. */
export async function recoverEvidenceBeam(initial: WorkingResult[], known: WorkingResult[], options: BeamOptions,
  expand:(parents:WorkingResult[])=>Promise<WorkingResult[]>, judge:(rows:WorkingResult[])=>Promise<WorkingResult[]>) {
  const knownKeys = new Set(known.filter(r => r.jev).map(evidenceKey)), seen = new Set<string>(), expanded = new Set<string>()
  const accepted:WorkingResult[] = [], trace:Array<{depth:number; examined:number; accepted:number; frontier:string[]}> = []
  let frontier = initial.slice(0,options.width), evaluated = 0, status = 'depth-limit'
  for (let depth=1; depth<=options.depth; depth++) {
    options.signal?.throwIfAborted()
    if (Date.now()>=options.deadline) {status='deadline';break}
    frontier=frontier.filter(r=>!expanded.has(evidenceKey(r)))
    if (!frontier.length) {status='exhausted';break}
    const parents=new Set(frontier.map(evidenceKey))
    frontier.forEach(r=>expanded.add(evidenceKey(r)))
    const candidates=(await expand(frontier)).filter(r=>!seen.has(evidenceKey(r)) && !expanded.has(evidenceKey(r)) &&
      r.evidenceRelations?.some(e=>e.resolved && parents.has(e.caller)))
    const parentOrder = new Map(frontier.map((r,i) => [evidenceKey(r),i]))
    // Storage order is not relevance. Explore short direct callees of the leading
    // implementation first, rather than letting unrelated files consume the cap.
    const parentRank = (r:WorkingResult) => Math.min(...(r.evidenceRelations ?? [])
      .filter(e=>e.resolved).map(e=>parentOrder.get(e.caller) ?? frontier.length),frontier.length)
    const unique=[...new Map(candidates.map(r=>[evidenceKey(r),r])).values()]
      .sort((a,b)=>parentRank(a)-parentRank(b) || Number(!!a.contentTruncated)-Number(!!b.contentTruncated)
        || a.content.length-b.content.length || evidenceKey(a).localeCompare(evidenceKey(b)))
    const batch=unique.slice(0,Math.max(0,options.maxCandidates-evaluated))
    if (!batch.length) {status=evaluated>=options.maxCandidates?'candidate-limit':'exhausted';break}
    batch.forEach(r=>seen.add(evidenceKey(r)))
    if (Date.now()>=options.deadline) {status='deadline';break}
    const judged=await judge(batch);evaluated+=batch.length
    const batchKeys=new Set(batch.map(evidenceKey))
    if (judged.length!==batch.length || new Set(judged.map(evidenceKey)).size!==batch.length || judged.some(r=>!r.jev || !batchKeys.has(evidenceKey(r)))) {status='evaluation-unavailable';break}
    const useful=judged.filter(r=>(!knownKeys.has(evidenceKey(r)) || (r.jev!.dimensions?.dependency ?? 0)>= EVIDENCE_POLICY.admission)
      && !r.contentTruncated && Math.max(r.jev!.evidence,r.jev!.contradiction,r.jev!.dimensions?.dependency ?? 0)>= EVIDENCE_POLICY.admission)
    accepted.push(...useful)
    // Wrappers with an explicit delegated gap can lead to the missing implementation.
    frontier=judged.filter(r=>!r.contentTruncated && (r.jev!.relevant>= EVIDENCE_POLICY.admission || r.jev!.evidence>= EVIDENCE_POLICY.admission))
      .sort((a,b)=>priority(b)-priority(a)).slice(0,options.width)
    trace.push({depth,examined:batch.length,accepted:useful.length,frontier:frontier.map(evidenceKey)})
    if (evaluated>=options.maxCandidates) {status='candidate-limit';break}
  }
  return {results:accepted,evaluated,trace,status}
}
function priority(row:WorkingResult) {
  const s=row.jev!
  return Math.max(s.evidence,s.contradiction,s.dimensions?.missing_helper ?? 0,s.dimensions?.missing_condition ?? 0)
}
