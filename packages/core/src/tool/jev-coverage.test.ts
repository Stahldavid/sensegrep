import { describe, it, expect } from "vitest"
import { evidenceAspects, evidenceShortlist, selectEvidenceCoverage, coverageSummary, candidateTrace, repairEvidencePacket, linkedEvidence, selectionDecisions, appendContributions, contributionShortlist, appendReferencedConstants } from "./jev-coverage.js"
import { TreeSitterChunking } from "../semantic/chunking-treesitter.js"
import type { WorkingResult } from "./sensegrep-pipeline.js"
const row = (name: string, a0: number, a1: number): WorkingResult => ({ file: `${name}.ts`, startLine: 1, endLine: 4,
  content: `function ${name}() { return true }`, semanticScore: 0.7, metadata: { symbolName: name },
  jev: { relevant: 0.9, evidence: 0.9, contradiction: 0, aspects: { a0, a1 } } })
describe("query evidence coverage", () => {
  it('does not force a referenced constant into context after a negative necessity judgment',()=>{
    const parent=row('send',.9,0),timeout={...row('timeout',0,0),requiredBy:['send.ts:1:4:send'],jev:{relevant:.1,evidence:.1,contradiction:0,dimensions:{dependency:.05},aspects:{a0:0}}}
    const result=selectEvidenceCoverage([parent,timeout],evidenceAspects('dry run'),200,2,()=>100)
    expect(result.results).toEqual([parent])
  })
  it('does not turn retained unassessed source into coverage proof', () => {
    const unknown={...row('unknown',1,1),jev:undefined}
    const aspects=evidenceAspects('first rule; second rule')
    const result=selectEvidenceCoverage([],aspects,100,1,()=>100,[unknown])
    expect(result.results).toEqual([unknown])
    expect(coverageSummary(result.results,aspects).every(a=>a.status==='not-found-in-selected-evidence')).toBe(true)
    expect(selectEvidenceCoverage([],aspects,99,1,()=>100,[unknown]).results).toEqual([])
  })
  it('keeps lexical and vector leaders when local anchors consume reservations', () => {
    const lexical={...row('lexical',.9,0),retrievalSources:['lexical'] as WorkingResult['retrievalSources']}
    const vector={...row('vector',0,.9),retrievalSources:['vector'] as WorkingResult['retrievalSources']}
    const anchors=Array.from({length:5},(_,i)=>row(`anchor${i}`,.5,.5))
    const helpers=Array.from({length:8},(_,i)=>({...row(`helper${i}`,.1,.1),jevOnly:true}))
    const selected=evidenceShortlist([lexical,vector,...anchors,...helpers],12,anchors)
    expect(selected).toHaveLength(12)
    expect(selected).toEqual(expect.arrayContaining([lexical,vector,...anchors]))
  })
  it('reserves actual local packet winners before expanded helpers', () => {
    const noise = Array.from({length: 12}, (_,i) => row(`noise${i}`, .1, .1))
    const anchor = row('commission', .9, .9)
    const helpers = Array.from({length: 8}, (_,i) => ({...row(`helper${i}`, .1, .1), jevOnly:true}))
    const result = evidenceShortlist([...noise,anchor,...helpers],12,[{...anchor}])
    expect(result).toContain(anchor)
    expect(result).toHaveLength(12)
    expect(evidenceShortlist([anchor],0,[anchor])).toEqual([])
  })
  it('preserves an inspected packet while recovery adds a complement', () => {
    const anchor=row('anchor',.8,0), replacement=row('replacement',.99,0), helper=row('helper',0,.9)
    const result=selectEvidenceCoverage([replacement,helper,anchor],evidenceAspects('first rule; second rule'),200,2,()=>100,[anchor])
    expect(result.results).toEqual([anchor,helper])
    expect(result.estimatedTokens).toBe(200)
    expect(selectEvidenceCoverage([replacement],evidenceAspects('first rule'),100,1,()=>100,[anchor]).results).toEqual([anchor])
  })
  it('does not infer redundancy of distinct sources from matching aspect scores',()=>{
    const root=row('root',.9,0),helper={...row('helper',0,.9),requiredBy:['root.ts:1:4:root']},redundant=row('redundant',0,.9)
    expect(selectEvidenceCoverage([root,helper,redundant],evidenceAspects('first rule; second rule'),300,3,()=>100).results).toEqual([root,helper,redundant])
  })
  it('does not replace an anchor based on unrelated probability differences',()=>{
    const expensive=row('expensive',.8,.8),compact=row('compact',.9,.9)
    expect(selectEvidenceCoverage([expensive,compact],evidenceAspects('first rule; second rule'),300,1,r=>r===expensive?250:100).results).toEqual([expensive])
  })
  it('packs constants of a conditionally added implementation without admitting unrelated literals',()=>{
    const parent=row('timezone',.9,0),literal={...row('default',0,0),requiredBy:['timezone.ts:1:4:timezone'],jev:undefined}
    const unbound=row('unbound',0,0)
    expect(appendReferencedConstants([parent],[unbound,literal],200,2,()=>100).results).toEqual([parent,literal])
    expect(appendReferencedConstants([parent],[literal],100,2,()=>100).results).toEqual([parent])
    expect(appendReferencedConstants([parent],[{...literal,requiredBy:['different.ts:1:4:other']}],200,2,()=>100).results).toEqual([parent])
  })
  it('preserves the first eligible implementation instead of selecting its higher-aspect helper first',()=>{
    const caller=row('hash',.7,0),helper=row('salt',.99,0)
    helper.evidenceRelations=[{caller:'hash.ts:1:4:hash',file:caller.file,line:2,target:'salt',kind:'call',
      callsite:'salt()',callerSignature:'hash()',resolved:true}]
    const result=selectEvidenceCoverage([caller,helper],evidenceAspects('hash and salt'),200,2,()=>100)
    expect(result.results).toEqual([caller,helper])
  })
  it('recovers an omitted caller by conditional contribution without reversing dependency edges',()=>{
    const helper=row('salt',.95,0),caller=row('hash',.9,0),noise=row('noise',.9,0)
    caller.jev={...caller.jev!,contribution:.95};noise.jev={...noise.jev!,contribution:.1}
    expect(appendContributions([helper],[noise,caller],200,2,()=>100).results).toEqual([helper,caller])
    expect(appendContributions([helper],[caller],100,2,()=>100).results).toEqual([helper])
    expect(appendContributions([helper],[caller],200,1,()=>100).results).toEqual([helper])
    expect(appendContributions([helper],[{...caller,contentTruncated:true}],200,2,()=>100).results).toEqual([helper])
    caller.jev={...caller.jev!,relevant:.2,evidence:.9}
    noise.jev={...noise.jev!,relevant:.2,evidence:.2}
    expect(contributionShortlist([helper,caller,noise],[helper])).toEqual([caller])
  })
  it('packs a caller-conditioned helper even when it is not an independent answer',()=>{
    const anchor=row('encrypt',.95,0),helper=row('key',.05,0),noise=row('format',.05,0),wrapper=row('wrapper',.95,0)
    const relation={caller:'encrypt.ts:1:4:encrypt',file:anchor.file,line:2,target:'key',kind:'call' as const,
      callsite:'key()',callerSignature:'encrypt()',resolved:true as const}
    helper.evidenceRelations=[relation]; noise.evidenceRelations=[{...relation,target:'format'}]
    helper.jev={...helper.jev!,evidence:.05,dimensions:{dependency:.95},category:'supporting'}
    noise.jev={...noise.jev!,evidence:.05,dimensions:{dependency:.05},category:'weak'}
    const selected=selectEvidenceCoverage([anchor,wrapper,noise,helper],evidenceAspects('encryption'),200,2,()=>100)
    expect(selected.results).toEqual([anchor,helper])
    expect(linkedEvidence(anchor,[helper])).toBe(false)
    expect(selectionDecisions([noise],selected.results,200,2,()=>100)[0].reason).toBe('no-usable-evidence')
    expect(selectionDecisions([helper],[anchor],100,2,()=>100)[0].reason).toBe('token-budget')
  })
  it('preserves a referenced literal without claiming that it answers independently',()=>{
    const anchor=row('check',.9,0),constant=row('limit',0,0)
    constant.requiredBy=['check.ts:1:4:check'];constant.jev=undefined
    const result=selectEvidenceCoverage([anchor,constant],evidenceAspects('rule'),200,2,()=>100)
    expect(result.results).toEqual([anchor,constant])
    expect(selectEvidenceCoverage([constant],evidenceAspects('rule'),200,2,()=>100).results).toEqual([])
  })
  it('retains an uncertain resolved helper without declaring its aspect supported', () => {
    const anchor = row('anchor', .9, .1), helper = row('helper', .1, .95)
    helper.requiredBy = ['anchor.ts:1:4:anchor']
    helper.jev = {...helper.jev!, evidence:.45, category:'unassessed'}
    const aspects = evidenceAspects('rule', ['operation','exception'])
    const selected = selectEvidenceCoverage([anchor,helper],aspects,200,2,()=>100)
    expect(selected.results).toEqual([anchor,helper])
    expect(coverageSummary(selected.results,aspects)[1].status).toBe('not-found-in-selected-evidence')
  })
  it('repairs a nonempty remote packet while enforcing token and result limits', () => {
    const anchor=row('anchor',.9,.1), helper=row('helper',.1,.9), peripheral=row('other',.9,.1)
    helper.requiredBy=['anchor.ts:1:4:anchor']
    helper.jev={...helper.jev!,evidence:.4,category:'unassessed'}
    const repaired=repairEvidencePacket([peripheral],[anchor],[helper],200,2,()=>100)
    expect(repaired.results).toEqual([anchor,helper])
    expect(repaired.estimatedTokens).toBe(200)
    expect(repairEvidencePacket([anchor],[anchor],[helper],100,1,()=>100).results).toEqual([anchor])
  })
  it('never rescues a clearly unrelated or truncated candidate', () => {
    const anchor=row('anchor',.9,.1), noise=row('noise',.9,.9)
    noise.jev={...noise.jev!,relevant:.1,evidence:.1,category:'weak'}
    expect(repairEvidencePacket([anchor],[noise],[],200,2,()=>100).results).toEqual([anchor])
    expect(repairEvidencePacket([anchor],[{...noise,contentTruncated:true}],[],200,2,()=>100).results).toEqual([anchor])
  })
  const aspects = evidenceAspects("payout", ["minimum amount", "small balance age exception"])
  it("selects a complementary exception over a repeated implementation within budget", () => {
    const rows = [row("minimum", .95, .01), row("wrapper", .9, .01), row("exception", .1, .95)]
    const selected = selectEvidenceCoverage(rows, aspects, 200, 2, () => 100)
    expect(selected.results.map(r => r.metadata.symbolName)).toEqual(["minimum", "exception"])
    expect(selected.estimatedTokens).toBe(200)
    expect(coverageSummary(selected.results, aspects).every(a => a.status === "supported")).toBe(true)
  })
  it("does not claim support from omitted source or invent requirements", () => {
    expect(coverageSummary([{...row("partial",1,1),contentTruncated:true}],aspects).every(a=>a.evidence.length===0)).toBe(true)
    expect(evidenceAspects("Where is encryption?")).toEqual([{ id:"a0",text:"Where is encryption?",origin:"query" }])
    expect(evidenceAspects("read and write")).toHaveLength(1)
  })
  it("retains distinct useful sources and resolved dependencies despite equal scores", () => {
    const first=row("rule",.95,.95), repeat=row("wrapper",.95,.95), dependency=row("literal",.1,.1)
    dependency.requiredBy=[`${first.file}:${first.startLine}:${first.endLine}:${first.metadata.symbolName}`]
    const selected=selectEvidenceCoverage([first,repeat,dependency],aspects,12000,10,()=>100)
    expect(selected.results.map(r=>r.metadata.symbolName)).toEqual(["rule","literal","wrapper"])
  })
  it("reserves vector, lexical and helper candidates with stable local order", () => {
    const rows = Array.from({length:12},(_,i)=>row(`f${i}`,0,0))
    rows[0].retrievalSources=["vector"];rows[10].retrievalSources=["lexical"];rows[11].retrievalSources=["helper"]
    const chosen=evidenceShortlist(rows,6)
    expect(chosen).toHaveLength(6)
    expect(chosen).toEqual(expect.arrayContaining([rows[0],rows[10],rows[11]]))
    expect(candidateTrace({ chosen }).chosen.candidates[0]).not.toHaveProperty("content")
  })
  it("does not spend the packet on an ineligible relative winner or mark its aspects covered", () => {
    const uncertain = row("testChunk", 1, 1)
    uncertain.jev = {...uncertain.jev!, evidence:.55, category:"unassessed"}
    const implementation = row("implementation", .8, .8)
    const selected = selectEvidenceCoverage([uncertain, implementation],aspects,200,2,()=>100)
    expect(selected.results).toEqual([implementation])
    expect(coverageSummary([uncertain],aspects).every(a=>a.strength===0)).toBe(true)
  })
  it("requests local fallback when assessed evidence cannot fit rather than selecting noise", () => {
    const large = row("large", 1, 1), noise = row("noise", .9, .9)
    noise.jev = {...noise.jev!, evidence:.1, category:"weak"}
    expect(selectEvidenceCoverage([large,noise],aspects,100,2,r=>r===large?200:50).results).toEqual([])
    expect(selectEvidenceCoverage([{...large,contentTruncated:true}],aspects,100,2,()=>50).results).toEqual([])
  })
  it("extracts exact whole AST statements and keeps nested guards together", async () => {
    const source = "export function pay(x) {\n if (!x) {\n  throw new Error('denied')\n }\n const total = x * 2\n return total\n}"
    const blocks = await TreeSitterChunking.evidenceBlocks(source,"pay.ts")
    expect(blocks).toEqual([{startLine:1,endLine:1,guard:false,signature:true}, {startLine:2,endLine:4,guard:true,signature:false},
      {startLine:5,endLine:5,guard:false,signature:false},{startLine:6,endLine:6,guard:true,signature:false}])
    expect(await TreeSitterChunking.evidenceBlocks("function bad( {","pay.ts")).toEqual([])
    expect(await TreeSitterChunking.evidenceBlocks("function one(){}; function two(){}","pay.ts")).toEqual([])
    expect(await TreeSitterChunking.evidenceBlocks("function one(){a();b()}","pay.ts")).toEqual([])
  })
  it("bundles only referenced literal constants, never calls or string mentions", async () => {
    const source="const LIMIT = 10\nconst UNUSED = 99\nconst DYNAMIC = secret()\nfunction check(n) {\n return n < LIMIT && DYNAMIC && 'UNUSED'\n}"
    expect(await TreeSitterChunking.evidenceConstants(source,"check.ts",4,6)).toEqual([{symbol:"LIMIT",startLine:1,endLine:1,content:"const LIMIT = 10"}])
    const shadow="const LIMIT = 10\nfunction check() {\n const LIMIT = 2\n return LIMIT\n}"
    expect(await TreeSitterChunking.evidenceConstants(shadow,"check.ts",2,5)).toEqual([])
    expect(await TreeSitterChunking.evidenceConstants("const LIMIT = 10\nfunction check({LIMIT}) { return LIMIT }","check.ts",2,2)).toEqual([])
  })
})
