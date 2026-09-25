import { describe, it, expect, vi } from "vitest"
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { assessJevQuery, evaluateWithJev, assessJevEvidence, assessJevPacket, parseJevScores, rankWithJev, resolveJevMode, JEV_REQUEST_BYTES } from "./jev.js"
import type { WorkingResult } from "./sensegrep-pipeline.js"
const row = (name: string, score = 0.7, content = `function ${name}() { return true }`): WorkingResult => ({ file: `${name}.ts`, startLine: 1, endLine: 3, content, semanticScore: score, metadata: { symbolName: name, symbolType: "function" } })
const deps = (fetcher: typeof fetch) => ({ fetch: fetcher, apiKey: "test-key", cache: false })
function response(body: any, evidence: (candidate: any, criterion: string) => number = () => 0.8) {
  const answers = Object.fromEntries(Object.entries(body.questions).map(([id, question]) => {
    const q = question as any
    const [cid, criterion] = id.split("_")
    const candidate=body.state.candidates[cid]
    const v = evidence({...candidate,content:candidate.evidenceState ? JSON.stringify(candidate.evidenceState) : candidate.content}, criterion)
    const selected = q.type === "choice" && q.criteria?.supports ? (v>=.8 ? "supports" : "says_nothing") : Object.keys(q.criteria ?? {})[0]
    return [id, q.type === "noul" ? { type: "noul", noul: v } : q.type === "score"
      ? { type: "score", score: v * 3, confidence: 0.5, probabilities: { "0": 1-v, "1": 0, "2": 0, "3": v } }
      : { type: "choice", choice: selected, confidence: 1, probabilities: Object.fromEntries(Object.keys(q.criteria).map(k => [k, k === selected ? 1 : 0])) }]
  }))
  return { model: "typesafe/jev-1.13-test", answers, usage: { input_tokens: 100, output_tokens: 50, cost: 0.001 } }
}
const mock = (fn?: (candidate: any, criterion: string) => number) => vi.fn(async (_url, init) => Response.json(response(JSON.parse(init!.body as string), fn))) as ReturnType<typeof vi.fn> & typeof fetch

describe("bounded Jev decisions", () => {
  it('sends a bounded joint witness without repeating caller bodies on every edge',async()=>{
    const caller=row('caller'),helpers=Array.from({length:12},(_,i)=>({...row(`helper${i}`),evidenceRelations:[{
      caller:'caller.ts:1:3:caller',file:caller.file,line:2,target:`helper${i}`,kind:'call' as const,resolved:true as const,
      callsite:'helper()',callerSignature:'function caller()',callerContent:'x'.repeat(12000),
    }]}))
    const fetcher=mock(()=>.95)
    await assessJevPacket('requested rules',[caller,...helpers],{mode:'evidence',jointPacket:true},deps(fetcher))
    expect(fetcher).toHaveBeenCalledTimes(1)
    const serialized=fetcher.mock.calls[0][1].body as string
    expect(Buffer.byteLength(serialized)).toBeLessThan(JEV_REQUEST_BYTES)
    const state=JSON.parse(serialized).state.candidates.c0.evidenceState
    expect(state.sources).toHaveLength(13)
    expect(state.sources.some((s:any)=>s.content===caller.content)).toBe(true)
    expect(state.resolvedCalls).toHaveLength(12)
    expect(state.resolvedCalls.every((r:any)=>!r.callerContent)).toBe(true)
  })
  it('verifies complementary independent sources together without inventing graph edges',async()=>{
    const fetcher=mock(()=>.95)
    await assessJevPacket('encrypt and decrypt',[row('encrypt'),row('decrypt')],{mode:'evidence',jointPacket:true},deps(fetcher))
    expect(fetcher).toHaveBeenCalledTimes(1)
    const state=JSON.parse(fetcher.mock.calls[0][1].body).state.candidates.c0.evidenceState
    expect(state.sources).toHaveLength(2)
    expect(state.resolvedCalls).toEqual([])
    expect(state.sources.map((s:any)=>s.id)).toEqual(expect.arrayContaining(['encrypt.ts:1:3:encrypt','decrypt.ts:1:3:decrypt']))
  })
  it('does not let a joint packet bypass a missing-definition veto',async()=>{
    const fetcher:typeof fetch=async(_url,init)=>{
      const raw=response(JSON.parse(init!.body as string),(_candidate,criterion)=>criterion==='contradiction'?0:.95)
      const gap=raw.answers.c0_gap0 as any
      gap.choice='missing_definition';gap.probabilities=Object.fromEntries(Object.keys(gap.probabilities).map(k=>[k,k==='missing_definition'?1:0]))
      return Response.json(raw)
    }
    const result=await assessJevPacket('required behavior',[row('wrapper'),row('other')],{mode:'evidence',jointPacket:true},deps(fetcher))
    expect(result.verdict).toBe('partial-evidence')
    expect(result.coverage[0].witnesses).toEqual([])
  })
  it('keeps the missing-definition veto for open questions',async()=>{
    const fetcher:typeof fetch=async(_url,init)=>{
      const raw=response(JSON.parse(init!.body as string),()=>.95)
      const a=raw.answers.c0_gap0 as any
      a.choice='missing_definition';a.probabilities=Object.fromEntries(Object.keys(a.probabilities).map(k=>[k,k==='missing_definition'?1:0]))
      return Response.json(raw)
    }
    const result=await assessJevPacket('Does dry-run send?',[row('wrapper')],{mode:'evidence',aspects:[{id:'a0',text:'Does dry-run send?',origin:'query',queryMode:'open-question'}]},deps(fetcher))
    expect(result.verdict).toBe('partial-evidence')
    expect(result.coverage[0].witnesses).toEqual([])
  })
  it('isolates standalone evidence from its caller while preserving dependency context',async()=>{
    const caller=row('send'),value={...row('timeout'),requiredBy:['send.ts:1:3:send'],evidenceRelations:[{caller:'send.ts:1:3:send',file:'send.ts',line:2,target:'timeout',kind:'call' as const,callsite:'timeout()',callerSignature:'function send()',callerContent:'function send(){ return dryRun() }',resolved:true as const}]}
    const initial=mock(()=>.1)
    await evaluateWithJev('dry run',[caller,value],{mode:'evidence'},deps(initial))
    const body=JSON.parse(initial.mock.calls[1][1].body)
    expect(body.state.candidates.c0.callers).toBeUndefined()
    expect(body.state.candidates.c0.relations[0].callerContent).toBeUndefined()
    const dependency=mock(()=>.1)
    await evaluateWithJev('dry run',[value],{mode:'evidence',rubric:'dependency',selected:[caller]},deps(dependency))
    expect(JSON.parse(dependency.mock.calls[0][1].body).state.candidates.c0.callers[0].symbol).toBe('send')
  })

  it('judges query premises without sending any code source',async()=>{
    const fetcher=mock(()=>.1)
    const result=await assessJevQuery('Does a dry run send a request?',{},deps(fetcher))
    expect(result.openQuestion).toBe(true)
    const body=JSON.parse(fetcher.mock.calls[0][1].body)
    expect(body.state.candidates.c0.content).toBe('')
    expect(Object.keys(body.questions)).toEqual(['c0_asserted_premise'])
    expect((await assessJevQuery('Dry run sends requests.',{},deps(mock(()=>.9)))).openQuestion).toBe(false)
  })
  it('allows negative answers to open questions without erasing asserted contradictions',async()=>{
    const rows=[row('dryRun',.9,'function dryRun() { return {sent:false} }')]
    const fetcher=mock(()=>.95)
    const open=await assessJevPacket('Does dry-run send?',rows,{mode:'evidence',aspects:[{id:'a0',text:'Does dry-run send?',origin:'query',queryMode:'open-question'}]},deps(fetcher))
    expect(open.verdict).toBe('direct-evidence')
    expect(JSON.parse(fetcher.mock.calls[0][1].body).questions.c0_aspect0.criteria).not.toHaveProperty('contradicts')
    const asserted=await assessJevPacket('Dry-run always sends.',rows,{mode:'evidence'},deps(mock(()=>.95)))
    expect(asserted.verdict).toBe('conflicting-evidence')
  })
  it('rejects a response that invents a contradiction option for an open question',async()=>{
    const fetcher:typeof fetch=async(_url,init)=>{
      const raw=response(JSON.parse(init!.body as string),()=>.95)
      ;(raw.answers.c0_aspect0 as any).probabilities.contradicts=0
      return Response.json(raw)
    }
    const result=await assessJevPacket('Does dry-run send?',[row('dryRun')],{mode:'evidence',aspects:[{id:'a0',text:'Does dry-run send?',origin:'query',queryMode:'open-question'}]},deps(fetcher))
    expect(result.verdict).toBe('not-assessed')
  })
  it('does not accept a witness whose explicit choice disagrees with support mass',async()=>{
    const fetcher:typeof fetch=async(_url,init)=>{
      const body=JSON.parse(init!.body as string),raw=response(body,(_c,k)=>k==='contradiction'?0:.95)
      for(const [key,answer] of Object.entries(raw.answers)) if(key.includes('_aspect')) (answer as any).choice='says_nothing'
      return Response.json(raw)
    }
    const result=await assessJevPacket('rule',[row('answer')],{mode:'evidence'},deps(fetcher))
    expect(result.verdict).toBe('partial-evidence')
    expect(result.coverage[0].witnesses).toEqual([])
  })
  it('stops scheduling batches after provider authorization or quota rejection',async()=>{
    const fetcher=vi.fn(async()=>new Response(null,{status:403})) as unknown as typeof fetch
    const result=await evaluateWithJev('rule',Array.from({length:20},(_,i)=>row(`r${i}`)),{mode:'both',batchSize:1},deps(fetcher))
    expect(result.diagnostics.requests).toBeLessThanOrEqual(4)
    expect(result.diagnostics.reason).toBe('provider-rejected-403')
    expect(result.diagnostics.status).toBe('fallback')
    expect(result.results).toHaveLength(20)
  })
  it('uses a small staged panel and keeps local order within eligible candidates',async()=>{
    const fetcher=mock((_c,key)=>key==='contradiction'?0:.9)
    const result=await evaluateWithJev('rule',[row('local',.9),row('other',.5)],{mode:'both'},deps(fetcher))
    expect(Object.keys(JSON.parse(fetcher.mock.calls[0][1].body).questions)).toEqual(['c0_relevant','c0_evidence','c0_contradiction','c0_aspect0'])
    expect(result.results.map(r=>r.file)).toEqual(['local.ts','other.ts'])
    expect(result.diagnostics.ranking).toBe('eligible')
  })
  it('evaluates necessity against the caller rather than standalone evidence',async()=>{
    const fetcher=mock((_c,key)=>key==='dependency'?.95:.05)
    const result=await evaluateWithJev('encryption',[row('key')],{mode:'evidence',rubric:'dependency',aspects:[],selected:[row('encrypt')]},deps(fetcher))
    expect(result.results[0].jev?.dimensions?.dependency).toBe(.95)
    expect(result.results[0].jev?.evidence).toBe(.05)
    const body=JSON.parse(fetcher.mock.calls[0][1].body)
    expect(body.state.selected[0].symbol).toBe('encrypt')
    expect(Object.keys(body.questions)).toHaveLength(5)
  })
  it("enables configured Jev by default with explicit opt-out precedence", async () => {
    const readConfig=vi.fn(async()=>({apiKey:"dedicated-test-key"}))
    expect(await resolveJevMode(undefined,{env:{},readConfig})).toBe("both")
    expect(await resolveJevMode("off",{env:{SENSEGREP_JEV_MODE:"both"},readConfig})).toBe("off")
    expect(await resolveJevMode(undefined,{env:{SENSEGREP_JEV_MODE:"off"},readConfig})).toBe("off")
    expect(await resolveJevMode(undefined,{env:{OPENROUTER_API_KEY:"generic"},readConfig:async()=>({})})).toBe("off")
    expect(await resolveJevMode(undefined,{env:{SENSEGREP_JEV_API_KEY:"dedicated"},readConfig})).toBe("both")
    expect(await resolveJevMode(undefined,{env:{},readConfig:async()=>{throw new Error("missing")}})).toBe("off")
    await expect(resolveJevMode(undefined,{env:{SENSEGREP_JEV_MODE:"invalid"},readConfig})).rejects.toThrow("Invalid SENSEGREP_JEV_MODE")
  })
  it('verifies literal requirements with three-way choices without invented premises',async()=>{
    const fetcher=mock((_c,key)=>key==='contradiction'?0:.9)
    const result=await assessJevPacket('Does the code encrypt data?', [row('encrypt')], {mode:'evidence',verifyAspects:true},deps(fetcher))
    expect(result.verdict).toBe('direct-evidence')
    expect(result.coverage[0].relations?.[0].choice).toBe('supports')
    const q=JSON.parse(fetcher.mock.calls[0][1].body).questions.c0_aspect0
    expect(q.instructions).toContain('Do not turn a question into an asserted fact')
    expect(Object.keys(q.criteria)).toEqual(['supports','contradicts','says_nothing'])
  })
  it("evaluates isolated witnesses for each explicit requirement", async () => {
    const rows = [row("encrypt", .7, "x".repeat(35000)), row("decrypt", .7, "y".repeat(35000))]
    const result = await assessJevPacket("encrypt and decrypt", rows, { mode:"evidence",
      aspects:[{id:"a0",text:"encryption",origin:"caller"},{id:"a1",text:"decryption",origin:"caller"}] }, deps(mock((c, criterion) => {
        if (criterion === "contradiction") return 0
        if (criterion === "aspect0") return c.content.includes("encrypt") ? .99 : .01
        if (criterion === "aspect1") return c.content.includes("decrypt") ? .99 : .01
        return .99
      })))
    expect(result.coverage.every(a=>a.witnesses.length===1)).toBe(true)
    expect(result.verdict).toBe("direct-evidence")
  })
  it("retains old confidence weighting only in the explicit baseline arm", () => {
    const rows=[row("local",.9),row("model",.2)]
    const scores=new Map(rows.map(r=>[`${r.file}:1:3:${r.metadata.symbolName}`,{relevant:.9,evidence:.9,contradiction:0,
      relevance:{score:r.file==="model.ts"?3:0,confidence:0,probabilities:{}}}]))
    const ranked=rankWithJev(rows,scores,"confidence-baseline")
    expect(ranked[0].file).toBe("local.ts")
    expect(ranked[0].jev).toMatchObject({localScore:.9,modelScore:0,rankingWeight:0})
  })
  it("does not discard evidence split between two useful levels", () => {
    const rows = [row("topic", .9), row("helper", .2)]
    const scores = new Map(rows.map((r,i) => [`${r.file}:1:3:${r.metadata.symbolName}`, {
      relevant: .9, evidence: .9, contradiction: 0, relevance: i
        ? { score: 2.55, confidence: .1, probabilities: {"0":0,"1":0,"2":.45,"3":.55} }
        : { score: 1, confidence: 1, probabilities: {"0":0,"1":1,"2":0,"3":0} } }]))
    for (const strategy of ["score", "useful", "rrf"] as const) {
      const ranked = rankWithJev(rows, scores, strategy)
      if (strategy !== "rrf") expect(ranked[0].metadata.symbolName).toBe("helper")
      expect(ranked.find(r => r.file === "helper.ts")?.jev).toMatchObject({ usefulMass: 1, directMass: .55, rankingWeight: 1 })
    }
  })
  it.each(["score", "noul"] as const)("isolates the %s panel to one question per candidate", async panel => {
    const fetcher = mock()
    const run = await evaluateWithJev("requested rule", [row("a"), row("b")], { mode:"both", panel, batchSize:2 }, deps(fetcher))
    expect(run.diagnostics.status).toBe("complete")
    expect(Object.keys(JSON.parse(fetcher.mock.calls[0][1].body).questions)).toHaveLength(2)
    expect(run.diagnostics.contractHash).toMatch(/^[a-f0-9]{64}$/)
    const other = await evaluateWithJev("requested rule", [row("a")], {mode:"both",panel,batchSize:1},deps(fetcher))
    expect(other.diagnostics.contractHash).not.toBe(run.diagnostics.contractHash)
  })
  it("evaluates research questions without passing labels or inventing relevance", async () => {
    const fetcher=mock()
    const run=await evaluateWithJev("rule",[row("a")],{mode:"evidence",featureQuestions:{
      direct:{type:"noul",instructions:"Does candidate implement query?"},
      support:{type:"score",instructions:"Describe support for query",criteria:["unrelated","topic only","helper","direct implementation"]},
    }},deps(fetcher))
    expect(run.diagnostics.status).toBe("complete")
    expect([...run.scores.values()][0]).toMatchObject({evidence:0,dimensions:{direct:.8}})
    expect([...run.scores.values()][0].dimensions?.support_mean).toBeCloseTo(.8)
    expect([...run.scores.values()][0].featureDistributions?.support['3']).toBe(.8)
    expect(Object.keys(JSON.parse(fetcher.mock.calls[0][1].body).questions)).toHaveLength(2)
    await expect(evaluateWithJev("rule",[row("a")],{mode:"both",featureQuestions:{x:{type:"noul",instructions:"x"}}},deps(fetcher))).rejects.toThrow()
    await expect(evaluateWithJev("rule",[row("a")],{mode:"evidence",featureQuestions:{x:{type:"noul",instructions:"x",unknown:true} as any}},deps(fetcher))).rejects.toThrow()
  })
  it("batches 20 candidates in four requests with explicit candidate references", async () => {
    const fetcher = mock((c, criterion) => criterion === "contradiction" ? 0 : c.symbol === "helper" ? 0.95 : 0.05)
    const rows = [...Array.from({length:19}, (_,i) => row(`screen${i}`)), row("helper")]
    const result = await evaluateWithJev("where is the rule", rows, { mode: "both", panel:"composite", batchSize:5 }, deps(fetcher))
    expect(result.diagnostics.status).toBe("complete")
    expect(result.results[0].metadata.symbolName).toBe("helper")
    expect(result.diagnostics.requests).toBe(4)
    expect(result.diagnostics.inputTokens).toBe(400)
    expect(result.scores.size).toBe(20)
    const body = JSON.parse(fetcher.mock.calls[0][1].body)
    expect(body.questions.c1_evidence.instructions).toContain("state.candidates.c1")
    expect(result.results[0].jev?.relevance?.probabilities).toHaveProperty("3")
  })
  it('isolates candidates by default while retaining concurrent question panels', async () => {
    const fetcher=mock()
    const result=await evaluateWithJev('rule',[row('a'),row('b')],{mode:'both'},deps(fetcher))
    expect(result.diagnostics.batchSize).toBe(1)
    expect(result.diagnostics.requests).toBe(2)
    for (const call of fetcher.mock.calls) {
      const body=JSON.parse(call[1].body)
      expect(Object.keys(body.state.candidates)).toHaveLength(1)
      expect(Object.keys(body.questions).length).toBeGreaterThan(1)
    }
  })
  it("preserves exact anchors and returns only supplied candidates", async () => {
    const rows = [row("exact",1.2),row("helper"),row("tail")]
    const result = await evaluateWithJev("rule", rows, {mode:"both",candidates:2}, deps(mock()))
    expect(result.results.map(r=>r.file)).toEqual(rows.map(r=>r.file))
    expect(result.scores.size).toBe(2)
  })
  it.each(["legacy","score","rrf"] as const)("supports %s ranking with stable ties", strategy => {
    const rows = [row("first"),row("second")]
    const scores = new Map(rows.map(r=>[`${r.file}:1:3:${r.metadata.symbolName}`,{relevant:0.8,evidence:0.8,contradiction:0}]))
    expect(rankWithJev(rows,scores,strategy).map(r=>r.file)).toEqual(rows.map(r=>r.file))
  })
  it("returns fallback without credentials, and makes no request when off", async () => {
    const fetcher = mock()
    expect((await evaluateWithJev("query",[row("a")],{mode:"both"},{...deps(fetcher),apiKey:""})).diagnostics.reason).toBe("missing-api-key")
    await evaluateWithJev("query",[row("a")],{mode:"off"},deps(fetcher))
    expect(fetcher).not.toHaveBeenCalled()
  })
  it("preserves the full local order after a partial batch failure", async () => {
    const rows = [row("a"),row("b")]
    const fetcher = vi.fn(async (_url, init) => {
      const body = JSON.parse(init!.body as string)
      return body.state.candidates.c0.symbol === "b" ? new Response("SECRET",{status:429}) : Response.json(response(body))
    })
    const result = await evaluateWithJev("rule",rows,{mode:"both",batchSize:1},deps(fetcher))
    expect(result.diagnostics.status).toBe("partial")
    expect(result.results).toBe(rows)
    expect(JSON.stringify(result.diagnostics)).not.toContain("SECRET")
  })
  it("bisects provider context errors without exceeding four concurrent requests", async () => {
    const fetcher = vi.fn(async (_url, init) => {
      const body = JSON.parse(init!.body as string)
      return Object.keys(body.state.candidates).length > 1 ? new Response(null,{status:413}) : Response.json(response(body))
    })
    const result = await evaluateWithJev("rule",[row("a"),row("b")],{mode:"both",batchSize:2},deps(fetcher))
    expect(result.diagnostics.status).toBe("complete")
    expect(result.diagnostics.requests).toBe(3)
    expect(result.diagnostics.splitRequests).toBe(1)
  })
  it("plans byte-bounded batches and marks oversized source", async () => {
    const fetcher = mock()
    const result = await evaluateWithJev("rule",Array.from({length:10},(_,i)=>row(`x${i}`,0.5,"á".repeat(30000))),{mode:"both",batchSize:10},deps(fetcher))
    expect(result.diagnostics.status).toBe("complete")
    expect(result.truncated.size).toBe(10)
    for(const [,init] of fetcher.mock.calls) expect(Buffer.byteLength(init.body)).toBeLessThanOrEqual(JEV_REQUEST_BYTES)
    expect(result.diagnostics.splitRequests).toBeGreaterThan(0)
  })
  it("requires every requested criterion and rejects invalid distributions", async () => {
    const fetcher = vi.fn(async (_url,init) => { const raw=response(JSON.parse(init!.body as string)); delete raw.answers.c0_role; return Response.json(raw) })
    expect((await evaluateWithJev("rule",[row("a")],{mode:"both",panel:"composite"},deps(fetcher))).diagnostics.status).toBe("fallback")
    expect(()=>parseJevScores({answers:{relevant:{type:"noul",noul:1.2}}})).toThrow()
  })
  it("judges the entire final packet, including changes after rank/diversity", async () => {
    const fetcher = mock((_c,k)=>k === "relevant" ? 0.95 : k === "evidence" ? 0.1 : 0)
    const packet = await assessJevPacket("which rules",[row("first"),row("last")],{mode:"evidence"},deps(fetcher))
    expect(packet.verdict).toBe("partial-evidence")
    expect(packet.fullyAssessed).toBe(true)
    expect(packet.resultCount).toBe(2)
    expect(fetcher.mock.calls.some(c=>JSON.stringify(JSON.parse(c[1].body).state.candidates.c0.evidenceState).includes("last.ts"))).toBe(true)
    expect(JSON.stringify(JSON.parse(fetcher.mock.calls[0][1].body).state.candidates.c0.evidenceState)).not.toContain("last.ts")
    const changed = await assessJevPacket("which rules",[row("first")],{mode:"evidence"},deps(fetcher))
    expect(packet.packetHash).not.toBe(changed.packetHash)
  })
  it("distinguishes direct, conflict, absent and unassessed evidence", async () => {
    const rows=[row("a")]
    expect((await assessJevPacket("rule",rows,{mode:"evidence"},deps(mock((_c,k)=>k==="contradiction"?0:0.95)))).verdict).toBe("direct-evidence")
    expect((await assessJevPacket("rule",rows,{mode:"evidence"},deps(mock(()=>0.9)))).verdict).toBe("conflicting-evidence")
    expect((await assessJevPacket("rule",rows,{mode:"evidence"},deps(mock(()=>0.01)))).status).toBe("weak-evidence")
    expect((await assessJevPacket("rule",[{...row("a"),contentTruncated:true}],{mode:"evidence"},deps(mock(()=>0)))).verdict).toBe("not-assessed")
  })
  it('does not equate strong contributions with a complete implementation', async () => {
    const packet=await assessJevPacket('rule and its exception',[row('rule')],{mode:'evidence'},
      deps(mock((_c,k)=>k==='contradiction'?0:k==='aspect0'?.1:.95)))
    expect(packet.verdict).toBe('partial-evidence')
  })
  it("does not call an unevaluated sixth candidate weak evidence", async () => {
    const rows=Array.from({length:6},(_,i)=>row(`x${i}`))
    const result=await evaluateWithJev("query",rows,{mode:"evidence",candidates:5},deps(mock(()=>0)))
    expect(assessJevEvidence(rows,result).fullyAssessed).toBe(false)
  })
  it("separates duplicate behavior dimensions and context contribution", async () => {
    const duplicates=await evaluateWithJev("compare",[row("a")],{mode:"evidence",rubric:"duplicates"},deps(mock()))
    expect([...duplicates.scores.values()][0].dimensions).toHaveProperty("authorization")
    expect(Object.keys([...duplicates.scores.values()][0].dimensions!)).toHaveLength(5)
    const fetcher=mock()
    const context=await evaluateWithJev("rule",[row("b")],{mode:"evidence",rubric:"context",selected:[row("a")]},deps(fetcher))
    expect([...context.scores.values()][0].contribution).toBe(0.8)
    expect(JSON.parse(fetcher.mock.calls[0][1].body).state.selected[0].symbol).toBe("a")
  })
  it("honors deadlines and propagates caller cancellation", async () => {
    const fetcher = vi.fn((_url,init)=>new Promise<Response>((_,reject)=>init!.signal!.addEventListener("abort",()=>reject(new Error("abort")),{once:true})))
    expect((await evaluateWithJev("rule",[row("a")],{mode:"both",timeoutMs:20},deps(fetcher))).diagnostics.reason).toBe("deadline")
    const controller=new AbortController();controller.abort()
    await expect(evaluateWithJev("rule",[row("a")],{mode:"both",signal:controller.signal},deps(fetcher))).rejects.toThrow()
  })
  it("keys cache by whole batch, order and anchor; stores no source or secret", async () => {
    const cacheDir=await mkdtemp(path.join(os.tmpdir(),"sensegrep-jev-batch-"))
    try {
      const fetcher=mock(), dependency={...deps(fetcher),cache:true,cacheDir}
      const rows=[row("a",0.7,"PRIVATE_SOURCE_A"),row("b",0.7,"PRIVATE_SOURCE_B")]
      await evaluateWithJev("query",rows,{mode:"both",batchSize:2},dependency)
      expect((await evaluateWithJev("query",rows,{mode:"both",batchSize:2},dependency)).diagnostics.cacheHits).toBe(2)
      await evaluateWithJev("query",[...rows].reverse(),{mode:"both",batchSize:2},dependency)
      await evaluateWithJev("query",rows,{mode:"both",batchSize:2,selected:[row("c")]},dependency)
      expect(fetcher).toHaveBeenCalledTimes(3)
      for(const file of await readdir(cacheDir)) { const text=await readFile(path.join(cacheDir,file),"utf8");expect(text).not.toContain("PRIVATE_SOURCE");expect(text).not.toContain("test-key") }
    } finally { await rm(cacheDir,{recursive:true,force:true}) }
  })
  it("does not spend a remote request on an empty final packet", async () => {
    const fetcher = mock()
    const result = await assessJevPacket("query", [], { mode: "evidence" }, deps(fetcher))
    expect(result.verdict).toBe("not-assessed")
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("partitions large final packets and never calls partial partitions a complete negative", async () => {
    const rows = Array.from({length:4}, (_,i) => row(`large${i}`,0.7,"x".repeat(35000)))
    const packet = await assessJevPacket("rule",rows,{mode:"evidence"},deps(mock(()=>0.01)))
    expect(packet.partitions).toBe(4)
    expect(packet.fullyAssessed).toBe(true)
    expect(packet.verdict).toBe("no-evidence-found")
    const fetcher = vi.fn(async (_url, init) => {
      const body = JSON.parse(init!.body as string)
      return body.state.candidates.c0.file.includes("large3.ts") ? new Response(null,{status:429}) : Response.json(response(body,()=>0.01))
    })
    const partial = await assessJevPacket("rule",rows,{mode:"evidence",batchSize:1},deps(fetcher))
    expect(partial.verdict).toBe("not-assessed")
  })

})
