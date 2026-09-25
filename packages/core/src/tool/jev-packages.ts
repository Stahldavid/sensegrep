import type { WorkingResult } from './sensegrep-pipeline.js'
import { estimateResultTokens } from './sensegrep-pipeline.js'
import { evidenceKey, linkedEvidence, type EvidenceAspect } from './jev-coverage.js'
import { evaluateWithJev, assessJevPacket, assessJevQuery, mergeJevDiagnostics, type JevQuestion } from './jev.js'
import { dependencyObligations, pendingObligations, gateWitnessAssessment } from './jev-witness.js'
import { EVIDENCE_POLICY } from './jev-policy.js'
import { evidenceTerms } from './search-quality.js'

export type ImplementationPackage = { root: WorkingResult; sources: WorkingResult[]; candidate: WorkingResult; bounded: boolean }
const overlap = (a:WorkingResult,b:WorkingResult) => a.file===b.file && a.startLine<=b.endLine && b.startLine<=a.endLine
const unique = (rows:WorkingResult[]) => {
  const merged=new Map<string,WorkingResult>()
  for(const row of rows) {
    const previous=merged.get(evidenceKey(row))
    merged.set(evidenceKey(row),previous?{...previous,...row,
      requiredBy:[...new Set([...(previous.requiredBy??[]),...(row.requiredBy??[])])],
      evidenceRelations:[...new Map([...(previous.evidenceRelations??[]),...(row.evidenceRelations??[])].map(e=>[`${e.caller}:${e.target}:${e.line}`,e])).values()]}:row)
  }
  return [...merged.values()]
}

/** Reserve semantic retrieval leaders independently of the local heuristic rerank. */
export function packageShortlist(rows:WorkingResult[],count:number) {
  const n=Math.max(1,Math.min(80,count))
  const semantic=[...rows].sort((a,b)=>b.semanticScore-a.semanticScore)
  // Interleave, so a later prefix truncation cannot erase the local half.
  return unique(rows.flatMap((row,i)=>[row,semantic[i]])).slice(0,n)
}

/** A graph bundle is a candidate, never a claim that all its calls are necessary.
 * Keep physical sources separate: their file/line identity must survive selection. */
export function implementationPackages(roots:WorkingResult[], pool:WorkingResult[], maxSources=8) : ImplementationPackage[] {
  const literals=pool.flatMap(parent=>(parent.bundleSources??[]).map(c=>({file:c.file,startLine:c.startLine,endLine:c.endLine,
    content:c.content,semanticScore:parent.semanticScore,metadata:{symbolName:c.symbol,symbolType:'variable'},requiredBy:[evidenceKey(parent)]} as WorkingResult)))
  const available=unique([...pool,...literals])
  return roots.filter(r=>!r.contentTruncated).map(root=>{
    const sources=[root],seen=new Set([evidenceKey(root)])
    let bounded=false
    for(let i=0;i<sources.length;i++) for(const child of available) {
      if(seen.has(evidenceKey(child)) || child.contentTruncated || !linkedEvidence(child,[sources[i]])) continue
      seen.add(evidenceKey(child))
      if(sources.some(s=>overlap(s,child))) continue
      if(sources.length>=maxSources) {bounded=true;continue}
      sources.push(child)
    }
    const content=sources.map(s=>`SOURCE ${evidenceKey(s)}\n${s.content}`).join('\n\n')
    return {root,sources,bounded,candidate:{...root,content,contentTruncated:content.length>24000,
      bundleSources:undefined,evidenceRelations:undefined,requiredBy:undefined,jev:undefined}}
  })
}

/** Rank packages; novelty here is exact source identity, NOT semantic coverage or
 * a subtraction of independent model probabilities. Completeness is judged later. */
export function selectImplementationPackages(packages:ImplementationPackage[], limit:number,maxTokens:number,
  tokens:(r:WorkingResult)=>number=estimateResultTokens) {
  const results:WorkingResult[]=[],selected:ImplementationPackage[]=[],rejected:Array<{root:string;reason:string}>=[]
  let estimatedTokens=0
  for(const packet of packages) {
    const additions=packet.sources.filter(r=>!results.some(s=>overlap(s,r)))
    const cost=additions.reduce((n,r)=>n+tokens(r),0)
    const reason=!additions.length?'covered-source':selected.length>=limit?'package-limit'
      :results.length+additions.length>40?'source-limit':estimatedTokens+cost>maxTokens?'token-budget':undefined
    if(reason) {rejected.push({root:evidenceKey(packet.root),reason});continue}
    // Atomic admission: never emit the parent while silently dropping its bundle.
    results.push(...additions);selected.push(packet);estimatedTokens+=cost
  }
  return {results,selected,rejected,estimatedTokens}
}

/** Preserve one additional independently useful implementation from another
 * file. Conditional novelty alone can hide valid variants of an underspecified
 * query (for example the same conversion with different timezone defaults). */
export function seedImplementationPackages(ranked:ImplementationPackage[],scores:Map<string,{evidence:number;dimensions?:Record<string,number>}>,limit:number,maxTokens:number,query='') {
  const first=ranked[0],wanted=new Set(evidenceTerms(query)),own=new Set(evidenceTerms(String(first?.root.metadata.symbolName??'')))
  // A parser alone can hide how its caller uses a fallback or propagates errors.
  // Prefer a proven direct caller when it is independently useful and its name
  // supplies an explicit query term absent from the helper's name.
  const caller=first && ranked.find(p=>p!==first && (scores.get(evidenceKey(p.root))?.evidence??0)>=EVIDENCE_POLICY.sufficient
    && evidenceTerms(String(p.root.metadata.symbolName??'')).some(term=>wanted.has(term)&&!own.has(term))
    && p.sources.some(source=>evidenceKey(source)===evidenceKey(first.root)&&linkedEvidence(source,[p.root])))
  const order=caller?[first,caller,...ranked.filter(p=>p!==first&&p!==caller)]:ranked
  let seed=selectImplementationPackages(order,Math.min(2,limit),maxTokens)
  if(seed.selected.length>=limit) return seed
  const variant=ranked.find(p=>!seed.selected.includes(p)&&!seed.selected.some(s=>s.root.file===p.root.file)
    && (scores.get(evidenceKey(p.root))?.evidence??0)>=EVIDENCE_POLICY.sufficient
    && (scores.get(evidenceKey(p.root))?.dimensions?.root_operation??0)>=EVIDENCE_POLICY.sufficient
    && selectImplementationPackages([...seed.selected,p],Math.min(3,limit),maxTokens).selected.includes(p))
  if(variant) seed=selectImplementationPackages([...seed.selected,variant],Math.min(3,limit),maxTokens)
  return seed
}

const questions:Record<string,JevQuestion>={
  relevant:{type:'noul',instructions:'Is this package in the system, domain and platform scope requested by query? This question is ONLY about scope, not whether a requested feature exists. A working-hours check remains in scope even if it ignores breaks. An HTTP parser for payments is out of scope for SMS status unless a supplied relationship connects it to SMS. Use paths, names and supplied caller relationships. For an unspecified platform, both web and mobile can be valid. A generic query may have several valid implementations.'},
  evidence:{type:'noul',instructions:'Does this package contain concrete implementation that helps ANSWER any part of query, with either a YES or a NO? For a question asking whether a check handles a condition, the complete check that ignores that condition is useful negative-answer evidence, not irrelevant code. Each SOURCE is a separate definition. Helpers may supply behavior delegated by the root. Do not require every requested part here. Topic resemblance, UI display and unrelated checks are insufficient.'},
  root_operation:{type:'noul',instructions:'Does the FIRST SOURCE implement the operation being inspected by query, rather than merely delegating to a supplied helper? It need not perform a behavior the user is asking WHETHER it performs: showing that the inspected check omits that behavior also answers the question. A relevant guard or branch counts. This is a preference for locating the actual rule, not a completeness check.'},
  contradiction:{type:'noul',instructions:'Does the supplied package refute an explicitly asserted factual premise of query? Answer false for an open question or missing implementation.'},
}

/** Discovery only: file cards nominate sources for full-code judging. A card's
 * probability never becomes evidence or a source's relevance score. */
export function packageDiscoveryCards(rows:WorkingResult[]) {
  const files=new Map<string,WorkingResult[]>()
  for(const row of rows.slice(0,240)) files.set(row.file,[...(files.get(row.file)??[]),row])
  return [...files].slice(0,160).map(([file,sources])=>({file,startLine:0,endLine:0,semanticScore:0,
    metadata:{symbolName:'source-catalog'},content:sources.slice(0,12).map(row=>
      `SYMBOL ${row.metadata.symbolName??'(anonymous)'} [${row.startLine}-${row.endLine}]\n${row.content.slice(0,900)}${row.content.length>900?'\n[discovery excerpt; full source required]':''}`).join('\n\n')}))
}

export async function evaluateImplementationContext(query:string,rows:WorkingResult[],options:{
  aspects:EvidenceAspect[];limit:number;maxTokens:number;candidates:number;timeoutMs:number;signal?:AbortSignal;
  localResults?:WorkingResult[];
  recovery:boolean;expand:(rows:WorkingResult[])=>Promise<{results:WorkingResult[];truncated:boolean}>;
},deps:Parameters<typeof evaluateWithJev>[3]={}) {
  const started=Date.now(),remaining=()=>Math.max(0,options.timeoutMs-(Date.now()-started))
  const verificationReserve=Math.min(2500,options.timeoutMs*.2)
  const inspectionReserve=Math.min(2500,options.timeoutMs*.2)
  const repairTime=()=>Math.max(0,remaining()-verificationReserve)
  let roots=packageShortlist(rows,options.candidates)
  const cards=packageDiscoveryCards(rows)
  const discovery=await evaluateWithJev(query,cards,{mode:'evidence',discovery:true,featureQuestions:{nomination:{type:'noul',
    instructions:'Does this file catalog contain a function or value worth inspecting in full to answer this query? Judge the requested operation and conditions. Prefer runtime implementation over tests, display-only code and documentation unless those are requested. Excerpts are incomplete: select plausible sources, never infer answer sufficiency from a card.'}},
    candidates:160,batchSize:8,timeoutMs:Math.max(1,Math.min(6000,remaining()*.25)),signal:options.signal},deps)
  const nominated=cards.filter(c=>(discovery.scores.get(evidenceKey(c))?.dimensions?.nomination??0)>=EVIDENCE_POLICY.admission)
    .sort((a,b)=>(discovery.scores.get(evidenceKey(b))?.dimensions?.nomination??0)-(discovery.scores.get(evidenceKey(a))?.dimensions?.nomination??0)).slice(0,6)
  const nominations=nominated.map(c=>rows.filter(r=>r.file===c.file).sort((a,b)=>
    Number(['type','interface'].includes(String(a.metadata.symbolType)))-Number(['type','interface'].includes(String(b.metadata.symbolType)))))
  const candidates=Array.from({length:Math.max(0,...nominations.map(r=>r.length))},(_,i)=>nominations.flatMap(r=>r[i]?[r[i]]:[])).flat()
  // Both sources survive every prefix: local/vector leaders and catalog discovery.
  roots=unique(roots.flatMap((row,i)=>[row,...(candidates[i]?[candidates[i]]:[])])).slice(0,options.candidates)
  let pool=[...rows],expansionBounded=false
  // Expand several independent roots before pruning by semantic judgments.
  if(options.recovery) for(let i=0;i<roots.length&&repairTime()>inspectionReserve+1000;i+=4) {
    try {
      const expanded=await options.expand(roots.slice(i,i+4))
      pool=unique([...pool,...expanded.results]);expansionBounded ||= expanded.truncated
    } catch {options.signal?.throwIfAborted();expansionBounded=true;break}
  }
  const packets=implementationPackages(roots,pool).filter(p=>!p.candidate.contentTruncated
    && p.sources.reduce((n,r)=>n+estimateResultTokens(r),0)<=options.maxTokens).slice(0,options.candidates)
  const discoveryBlocked=discovery.diagnostics.reason?.startsWith('provider-rejected-')
  const interpretation=await assessJevQuery(query,{timeoutMs:Math.max(1,Math.min(2500,repairTime())),signal:options.signal},discoveryBlocked?{...deps,apiKey:''}:deps)
  const aspects=options.aspects.map(a=>interpretation.openQuestion&&a.origin==='query'?{...a,queryMode:'open-question' as const}:a)
  const judged=await evaluateWithJev(query,packets.map(p=>p.candidate),{mode:'evidence',featureQuestions:questions,
    candidates:options.candidates,batchSize:1,timeoutMs:Math.max(1,repairTime()-inspectionReserve),signal:options.signal},discoveryBlocked||interpretation.diagnostics.reason?.startsWith('provider-rejected-')?{...deps,apiKey:''}:deps)
  // Feature outputs are deliberately not treated as runtime scores by the generic
  // research API. Promote only these explicitly defined package-level judgments.
  for(const score of judged.scores.values()) {
    score.evidence=score.dimensions?.evidence??0;score.relevant=score.dimensions?.relevant??0;score.contradiction=score.dimensions?.contradiction??0
  }
  let providerBlocked=[discovery.diagnostics.reason,judged.diagnostics.reason,interpretation.diagnostics.reason].some(reason=>reason?.startsWith('provider-rejected-'))
  const blocked=()=>providerBlocked
  mergeJevDiagnostics(judged.diagnostics,interpretation.diagnostics)
  mergeJevDiagnostics(judged.diagnostics,discovery.diagnostics)
  judged.diagnostics.queryInterpretation={assertedPremise:interpretation.assertedPremise,openQuestion:interpretation.openQuestion,status:interpretation.diagnostics.status}
  const packageRank=(p:ImplementationPackage)=>{
    const score=judged.scores.get(evidenceKey(p.root))
    const utility=.65*(score?.evidence??0)+.35*(score?.dimensions?.root_operation??0)
    // Budget preference, not a probability: large peripheral bundles should not
    // crowd out compact implementations before conditional contribution is checked.
    return utility/(1+p.sources.reduce((n,r)=>n+estimateResultTokens(r),0)/options.maxTokens)
  }
  const inScope=(p:ImplementationPackage)=>(judged.scores.get(evidenceKey(p.root))?.relevant??0)>=EVIDENCE_POLICY.admission
  const ranked=packets.filter(p=>!p.candidate.contentTruncated && inScope(p) && (judged.scores.get(evidenceKey(p.root))?.evidence??0)>=EVIDENCE_POLICY.admission)
    .sort((a,b)=>packageRank(b)-packageRank(a))
  let packed=seedImplementationPackages(ranked,judged.scores,options.limit,options.maxTokens,query)
  // If the provider cannot judge, retain local candidates as explicitly unassessed.
  if(!packed.results.length) {
    const localOrder=new Map(rows.map((row,i)=>[evidenceKey(row),i]))
    const fallback=options.localResults?.map(root=>({root,sources:[root],candidate:root,bounded:false}))
      ?? [...packets].sort((a,b)=>localOrder.get(evidenceKey(a.root))!-localOrder.get(evidenceKey(b.root))!)
    packed=selectImplementationPackages(fallback,options.limit,options.maxTokens)
  }

  // Conditional contribution is evaluated against the actual selected source set,
  // not inferred from competing relevance probabilities. One addition changes state.
  for(let pass=0;pass<3&&!blocked()&&packed.selected.length<options.limit&&repairTime()>inspectionReserve+750;pass++) {
    const alternatives=packets.filter(p=>!packed.selected.includes(p)&&!p.candidate.contentTruncated&&inScope(p)
      && (judged.scores.get(evidenceKey(p.root))?.evidence??0)>=EVIDENCE_POLICY.uncertaintyLow).slice(0,8)
    if(alternatives.length) {
      const contributed=await evaluateWithJev(query,alternatives.map(p=>p.candidate),{mode:'evidence',rubric:'context',aspects:[],
        selected:packed.results,candidates:8,batchSize:1,timeoutMs:Math.max(1,Math.min(1500,repairTime()-inspectionReserve)),signal:options.signal},deps)
      providerBlocked ||= !!contributed.diagnostics.reason?.startsWith('provider-rejected-')
      mergeJevDiagnostics(judged.diagnostics,contributed.diagnostics)
      const winner=alternatives.filter(p=>(contributed.scores.get(evidenceKey(p.root))?.contribution??0)>=EVIDENCE_POLICY.admission
        && selectImplementationPackages([...packed.selected,p],options.limit,options.maxTokens).selected.includes(p))
        .sort((a,b)=>(contributed.scores.get(evidenceKey(b.root))?.contribution??0)-(contributed.scores.get(evidenceKey(a.root))?.contribution??0))[0]
      if(winner) packed=selectImplementationPackages([...packed.selected,winner],options.limit,options.maxTokens)
      else break
    } else break
  }
  let inspection='not-assessed',obligations:ReturnType<typeof dependencyObligations>=[]
  for(let pass=0;pass<2&&!blocked()&&options.recovery&&repairTime()>300;pass++) try {
    const expanded=await options.expand(packed.results)
    // Keep newly discovered edges even for already selected source identities.
    packed.results=unique([...packed.results,...expanded.results.filter(r=>packed.results.some(s=>evidenceKey(s)===evidenceKey(r)))])
    const missing=expanded.results.filter(r=>!packed.results.some(s=>evidenceKey(s)===evidenceKey(r))&&linkedEvidence(r,packed.results))
    const checked=await evaluateWithJev(query,missing.slice(0,8),{mode:'evidence',rubric:'obligation',aspects,selected:packed.results,
      candidates:8,timeoutMs:Math.max(1,repairTime()),signal:options.signal},deps)
    providerBlocked ||= !!checked.diagnostics.reason?.startsWith('provider-rejected-')
    mergeJevDiagnostics(judged.diagnostics,checked.diagnostics)
    obligations=dependencyObligations(missing.map(r=>({...r,jev:checked.scores.get(evidenceKey(r))})),packed.results)
    inspection=expanded.truncated||missing.some(r=>!checked.scores.has(evidenceKey(r)))?'partial':'complete'
    let added=false
    for(const obligation of obligations.filter(o=>o.decision==='required')) {
      const row=missing.find(r=>evidenceKey(r)===obligation.target)!
      const cost=estimateResultTokens(row)
      if(row.contentTruncated||packed.results.some(s=>overlap(s,row))||packed.results.length>=40||packed.estimatedTokens+cost>options.maxTokens) continue
      packed.results.push(row);packed.estimatedTokens+=cost;added=true
    }
    if(!added) break
    inspection='partial' // newly admitted definitions need their own inspection
  } catch {options.signal?.throwIfAborted();inspection='unavailable';break}
  const pending=pendingObligations(obligations,packed.results)
  const assessment=await assessJevPacket(query,packed.results,{mode:'evidence',aspects,jointPacket:true,
    timeoutMs:Math.max(1,remaining()),signal:options.signal,inspection:{status:inspection,pending}},blocked()||remaining()<100?{...deps,apiKey:''}:deps)
  mergeJevDiagnostics(judged.diagnostics,assessment.evaluation)
  const evidence=gateWitnessAssessment(assessment,pending,inspection==='complete',aspects)
  judged.diagnostics.dependencyCheck={status:inspection,examined:obligations.length,pending}
  judged.diagnostics.packetStatus=evidence.verdict
  judged.diagnostics.contextStatus='implementation-packages'
  // Report the final decision, not the temporary two-package seed limit.
  packed.rejected=packets.filter(p=>!packed.selected.some(s=>evidenceKey(s.root)===evidenceKey(p.root))).map(p=>{
    const additions=p.sources.filter(r=>!packed.results.some(s=>overlap(s,r)))
    const score=judged.scores.get(evidenceKey(p.root))
    const reason=!additions.length?'covered-source':!score?'not-assessed':!inScope(p)?'incompatible-scope':score.evidence<EVIDENCE_POLICY.admission?'weak-evidence'
      :packed.results.length+additions.length>40?'source-limit'
      :packed.estimatedTokens+additions.reduce((n,r)=>n+estimateResultTokens(r),0)>options.maxTokens?'token-budget'
      :packed.selected.length>=options.limit?'package-limit':'contribution-not-established'
    return {root:evidenceKey(p.root),reason}
  })
  judged.diagnostics.packages={candidates:packets.length,selected:packed.selected.map(p=>({root:evidenceKey(p.root),sources:p.sources.map(evidenceKey),bounded:p.bounded})),
    rejected:packed.rejected,expansionBounded,sourceCount:packed.results.length,limitUnit:'implementation-packages',
    discovery:{status:discovery.diagnostics.status,files:cards.length,nominated:nominated.map(c=>c.file)},
    judgments:packets.map(p=>({root:evidenceKey(p.root),evidence:judged.scores.get(evidenceKey(p.root))?.evidence,
      operation:judged.scores.get(evidenceKey(p.root))?.dimensions?.root_operation}))}
  return {results:packed.results,estimatedTokens:packed.estimatedTokens,jev:{...judged,results:packed.results},evidence}
}
