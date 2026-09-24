import { describe, it, expect, vi } from "vitest"
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { evaluateWithJev, assessJevEvidence, assessJevPacket, parseJevScores, rankWithJev, JEV_REQUEST_BYTES } from "./jev.js"
import type { WorkingResult } from "./sensegrep-pipeline.js"
const row = (name: string, score = 0.7, content = `function ${name}() { return true }`): WorkingResult => ({ file: `${name}.ts`, startLine: 1, endLine: 3, content, semanticScore: score, metadata: { symbolName: name, symbolType: "function" } })
const deps = (fetcher: typeof fetch) => ({ fetch: fetcher, apiKey: "test-key", cache: false })
function response(body: any, evidence: (candidate: any, criterion: string) => number = () => 0.8) {
  const answers = Object.fromEntries(Object.entries(body.questions).map(([id, question]) => {
    const q = question as any
    const [cid, criterion] = id.split("_")
    const v = evidence(body.state.candidates[cid], criterion)
    const selected = Object.keys(q.criteria ?? {})[0]
    return [id, q.type === "noul" ? { type: "noul", noul: v } : q.type === "score"
      ? { type: "score", score: v * 3, confidence: 0.5, probabilities: { "0": 1-v, "1": 0, "2": 0, "3": v } }
      : { type: "choice", choice: selected, confidence: 1, probabilities: Object.fromEntries(Object.keys(q.criteria).map(k => [k, k === selected ? 1 : 0])) }]
  }))
  return { model: "typesafe/jev-1.13-test", answers, usage: { input_tokens: 100, output_tokens: 50, cost: 0.001 } }
}
const mock = (fn?: (candidate: any, criterion: string) => number) => vi.fn(async (_url, init) => Response.json(response(JSON.parse(init!.body as string), fn))) as ReturnType<typeof vi.fn> & typeof fetch

describe("bounded Jev decisions", () => {
  it("batches 20 candidates in four requests with explicit candidate references", async () => {
    const fetcher = mock((c, criterion) => criterion === "contradiction" ? 0 : c.symbol === "helper" ? 0.95 : 0.05)
    const rows = [...Array.from({length:19}, (_,i) => row(`screen${i}`)), row("helper")]
    const result = await evaluateWithJev("where is the rule", rows, { mode: "both" }, deps(fetcher))
    expect(result.diagnostics.status).toBe("complete")
    expect(result.results[0].metadata.symbolName).toBe("helper")
    expect(result.diagnostics.requests).toBe(4)
    expect(result.diagnostics.inputTokens).toBe(400)
    expect(result.scores.size).toBe(20)
    const body = JSON.parse(fetcher.mock.calls[0][1].body)
    expect(body.questions.c1_evidence.instructions).toContain("state.candidates.c1")
    expect(result.results[0].jev?.relevance?.probabilities).toHaveProperty("3")
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
    const result = await evaluateWithJev("rule",[row("a"),row("b")],{mode:"both"},deps(fetcher))
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
    expect((await evaluateWithJev("rule",[row("a")],{mode:"both"},deps(fetcher))).diagnostics.status).toBe("fallback")
    expect(()=>parseJevScores({answers:{relevant:{type:"noul",noul:1.2}}})).toThrow()
  })
  it("judges the entire final packet, including changes after rank/diversity", async () => {
    const fetcher = mock((_c,k)=>k === "relevant" ? 0.95 : k === "evidence" ? 0.1 : 0)
    const packet = await assessJevPacket("which rules",[row("first"),row("last")],{mode:"evidence"},deps(fetcher))
    expect(packet.verdict).toBe("partial-evidence")
    expect(packet.fullyAssessed).toBe(true)
    expect(packet.resultCount).toBe(2)
    expect(JSON.parse(fetcher.mock.calls[0][1].body).state.candidates.c0.content).toContain("last.ts")
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
      await evaluateWithJev("query",rows,{mode:"both"},dependency)
      expect((await evaluateWithJev("query",rows,{mode:"both"},dependency)).diagnostics.cacheHits).toBe(2)
      await evaluateWithJev("query",[...rows].reverse(),{mode:"both"},dependency)
      await evaluateWithJev("query",rows,{mode:"both",selected:[row("c")]},dependency)
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
      return body.state.candidates.c0.file === "final-packet-3" ? new Response(null,{status:429}) : Response.json(response(body,()=>0.01))
    })
    const partial = await assessJevPacket("rule",rows,{mode:"evidence",batchSize:1},deps(fetcher))
    expect(partial.verdict).toBe("not-assessed")
  })

})
