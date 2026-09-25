import { createHash } from 'node:crypto'
import { TreeSitterChunking } from '../semantic/chunking-treesitter.js'
import type { WorkingResult } from './sensegrep-pipeline.js'
import { evidenceKey, linkedEvidence, type EvidenceAspect, type EvidenceRelation } from './jev-coverage.js'
import { EVIDENCE_POLICY, EVIDENCE_CONTRACT } from './jev-policy.js'
export { EVIDENCE_POLICY } from './jev-policy.js'

/** Routing thresholds are deliberately separate: admission is not sufficiency.
 * These are uncalibrated application policies, not probability guarantees. */
export type EvidenceLocation = {id:string; source:string; hash:string; startLine:number; endLine:number; guard:boolean}
export type EvidenceState = {
  root:string; sources:Array<{id:string; hash:string; content:string; truncated:boolean; landmarks:EvidenceLocation[]}>
  resolvedCalls:EvidenceRelation[]; referencedConstants:Array<{source:string; callers:string[]}>
  missingDefinitions:Array<{target:string; callers:string[]; requirementIds:string[]}>
  inspectionLimits:{sourceLimit:number; sourceLimitReached:boolean; dependencyInspection:string}
}
/** Scores are interpretations, not source identity. Relations and truncation are facts. */
export function packetFingerprint(query:string, rows:WorkingResult[], aspects:EvidenceAspect[], inspection:unknown = null) {
  return createHash('sha256').update(JSON.stringify({contract:EVIDENCE_CONTRACT,query,aspects,inspection,
    rows:rows.map(r=>({id:evidenceKey(r),content:r.content,truncated:!!r.contentTruncated,
      relations:r.evidenceRelations ?? [],requiredBy:r.requiredBy ?? [],constants:r.bundleSources ?? [],state:r.evidenceState}))})).digest('hex')
}
export function necessityDecision(value: number | undefined) {
  return value === undefined ? 'not-assessed' : value >= EVIDENCE_POLICY.admission ? 'required'
    : value >= EVIDENCE_POLICY.uncertaintyLow ? 'uncertain' : 'not-required'
}
export const sourceHash = (row: WorkingResult) => createHash('sha256').update(row.content).digest('hex')

/** Closed source sets: only a root and its selected, directed descendants.
 * Unrelated constants with identical values cannot join a witness. AST landmarks
 * locate exact statements, while the full body preserves guards/control flow. */
export async function buildWitnesses(rows: WorkingResult[], inspection?:{status:string; pending:DependencyObligation[]}) {
  const canonical = [...new Map(rows.map(r => [evidenceKey(r), r])).values()]
    .sort((a,b) => evidenceKey(a).localeCompare(evidenceKey(b)))
  const sources = new Map<string, EvidenceState['sources'][number]>()
  for (const row of canonical.slice(0,80)) {
    const blocks = row.contentTruncated ? [] : await TreeSitterChunking.evidenceBlocks(row.content,row.file)
    const id=evidenceKey(row), hash=sourceHash(row), prefix=`s${createHash('sha256').update(id).digest('hex').slice(0,16)}`
    const landmarks:EvidenceLocation[]=blocks.filter(b=>!b.signature).map((b,i)=>({id:`${prefix}_statement_${i}`,source:id,hash,
      startLine:row.startLine+b.startLine-1,endLine:row.startLine+b.endLine-1,guard:b.guard}))
    // A whole-symbol option keeps composite rules and unsupported languages addressable.
    landmarks.push({id:`${prefix}_whole`,source:id,hash,startLine:row.startLine,endLine:row.endLine,guard:false})
    sources.set(id, {id,hash,content:row.content,truncated:!!row.contentTruncated,landmarks})
  }
  return canonical.slice(0,80).map(root => {
    const members = [root], seen = new Set([evidenceKey(root)])
    for (let i=0;i<members.length;i++) for (const child of canonical) {
      if (!seen.has(evidenceKey(child)) && sources.has(evidenceKey(child)) && linkedEvidence(child,[members[i]])) {
        members.push(child); seen.add(evidenceKey(child))
      }
    }
    const refs = members.map(r=>sources.get(evidenceKey(r))!).sort((a,b)=>a.id.localeCompare(b.id))
    const evidenceState:EvidenceState={root:evidenceKey(root),sources:refs,
      resolvedCalls:members.flatMap(r=>(r.evidenceRelations ?? []).filter(e=>seen.has(e.caller))),
      referencedConstants:members.filter(r=>r.requiredBy?.length).map(r=>({source:evidenceKey(r),callers:r.requiredBy!.filter(k=>seen.has(k))})),
      missingDefinitions:(inspection?.pending ?? []).filter(o=>o.callers.some(k=>seen.has(k))).map(o=>({target:o.target,callers:o.callers,requirementIds:o.requirementIds ?? []})),
      inspectionLimits:{sourceLimit:80,sourceLimitReached:canonical.length>80,dependencyInspection:inspection?.status ?? 'not-assessed'}}
    return {root:evidenceKey(root),sources:refs.map(({id,hash})=>({id,hash})), row:{
      file:`witness:${evidenceKey(root)}`,startLine:1,endLine:1,metadata:{},semanticScore:0,
      content:'',evidenceState,contentTruncated:refs.some(r=>r.truncated),
    } satisfies WorkingResult}
  })
}

export type DependencyObligation = {target:string; callers:string[]; sourceHash:string; necessity?:number; requirementIds?:string[];
  decision:ReturnType<typeof necessityDecision>}
export function dependencyObligations(candidates:WorkingResult[], selected:WorkingResult[]) : DependencyObligation[] {
  const keys=new Set(selected.map(evidenceKey))
  return candidates.filter(r=>linkedEvidence(r,selected)).map(r=>({target:evidenceKey(r),sourceHash:sourceHash(r),
    callers:[...new Set((r.evidenceRelations ?? []).filter(e=>keys.has(e.caller)).map(e=>e.caller))],
    requirementIds:Object.entries(r.jev?.dependencyAspects ?? {}).filter(([,p])=>p>=EVIDENCE_POLICY.uncertaintyLow).map(([id])=>id),
    necessity:r.jev?.dimensions?.dependency,decision:necessityDecision(r.jev?.dimensions?.dependency)}))
}
export function pendingObligations(obligations:DependencyObligation[], selected:WorkingResult[]) {
  const keys=new Set(selected.map(evidenceKey))
  return obligations.filter(o=>o.callers.some(k=>keys.has(k)) && o.decision!=='not-required'
    && !selected.some(r=>evidenceKey(r)===o.target && !r.contentTruncated && sourceHash(r)===o.sourceHash))
}

export function gateWitnessAssessment<T extends {verdict:string; missingAspects:string[]; reason?:string}>(
  assessment:T, pending:DependencyObligation[], inspectionComplete:boolean, requirements:Array<string|EvidenceAspect>):T {
  if(assessment.verdict!=='direct-evidence' || !pending.length && inspectionComplete) return assessment
  const affected=new Set(pending.flatMap(o=>o.requirementIds ?? []))
  const missing=requirements.filter((r):r is EvidenceAspect=>typeof r!=='string' && affected.has(r.id)).map(r=>r.text)
  return {...assessment,verdict:'partial-evidence',missingAspects:[...new Set([...assessment.missingAspects,...missing])],
    reason:pending.length ? 'unresolved-dependency-obligations' : 'dependency-inspection-incomplete'}
}

/** Make space only by removing unprotected tails. Never remove a necessary caller
 * or a previously admitted dependency to squeeze in a new one. */
export function packObligations(selected:WorkingResult[], candidates:WorkingResult[], obligations:DependencyObligation[],
  maxTokens:number|undefined, limit:number, tokens:(r:WorkingResult)=>number) {
  const results=[...selected], protectedKeys=new Set(obligations.filter(o=>o.decision==='required').flatMap(o=>[o.target,...o.callers]))
  let used=results.reduce((n,r)=>n+tokens(r),0)
  for(const o of pendingObligations(obligations,results).filter(o=>o.decision==='required')) {
    const row=candidates.find(r=>evidenceKey(r)===o.target && sourceHash(r)===o.sourceHash)
    if(!row || row.contentTruncated || tokens(row)>(maxTokens ?? Infinity)) continue
    if(results.some(r=>r.file===row.file && r.startLine<=row.endLine && row.startLine<=r.endLine)) continue
    const next=[...results];let nextUsed=used
    while(next.length>=limit || nextUsed+tokens(row)>(maxTokens ?? Infinity)) {
      const victim=[...next].reverse().find(r=>!protectedKeys.has(evidenceKey(r))
        && !linkedEvidence(r,next.filter(other=>other!==r))
        && !Object.entries(r.jev?.aspects ?? {}).some(([id,p])=>p>=EVIDENCE_POLICY.admission
          && ![...next.filter(other=>other!==r),row].some(other=>(other.jev?.aspects?.[id] ?? 0)>=p)))
      if(!victim) break
      next.splice(next.indexOf(victim),1);nextUsed-=tokens(victim)
    }
    if(next.length>=limit || nextUsed+tokens(row)>(maxTokens ?? Infinity)) continue
    results.splice(0,results.length,...next,row);used=nextUsed+tokens(row)
  }
  return {results,estimatedTokens:used}
}

/** Inspect dependencies of selected helpers before broad entry-point scaffolding.
 * This is graph traversal priority, not evidence of semantic necessity. */
export function orderDependencyInspection(rows:WorkingResult[],selected:WorkingResult[]) {
  const keys=new Set(selected.map(evidenceKey)),depth=new Map(selected.map(r=>[evidenceKey(r),0]))
  for(let pass=0;pass<selected.length;pass++) for(const row of selected) {
    const parents=(row.evidenceRelations ?? []).map(e=>e.caller).filter(k=>keys.has(k) && k!==evidenceKey(row))
    depth.set(evidenceKey(row),Math.min(selected.length,Math.max(depth.get(evidenceKey(row)) ?? 0,...parents.map(k=>(depth.get(k) ?? 0)+1))))
  }
  const parentDepth=(r:WorkingResult)=>Math.max(0,...(r.evidenceRelations ?? []).map(e=>depth.get(e.caller) ?? 0))
  return [...rows].sort((a,b)=>parentDepth(b)-parentDepth(a))
}
