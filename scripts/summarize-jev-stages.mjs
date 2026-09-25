import fs from 'node:fs/promises'
import path from 'node:path'
const dir=process.argv[2]??'docs/evaluations/jev-v5-2026-09-24'
const load=async name=>JSON.parse(await fs.readFile(path.join(dir,name),'utf8'))
const experiments=await Promise.all(['curaai-stages.json','sensegrep-stages.json'].map(load))
if(experiments[0].rows.length!==45||experiments[1].rows.length!==27)throw new Error('Expected complete 45+27 run matrix')
const rows=experiments.flatMap(x=>x.rows),arms=[...new Set(rows.map(x=>x.arm))]
const summary=Object.fromEntries(arms.map(arm=>{
  const armRows=rows.filter(x=>x.arm===arm),positive=armRows.filter(x=>!x.negative),negative=armRows.filter(x=>x.negative)
  return [arm,{positiveCases:positive.length,allRequired:positive.filter(x=>x.allRequired).length,
    meanRequiredRecall:positive.reduce((s,x)=>s+(x.requiredRecall??0),0)/positive.length,
    negativeCases:negative.length,weakNegatives:negative.filter(x=>x.weakEvidence).length,
    falseDirect:negative.filter(x=>x.verdict==='direct-evidence').length,failed:armRows.filter(x=>x.status==='failed').length,
    partialEvaluation:armRows.filter(x=>['partial','fallback'].includes(x.evaluationStatus)).length,
    cost:armRows.reduce((s,x)=>s+(x.cost??0),0)}]
}))
const agent=await load('agent-luna.json'),research=await load('research-real.json')
if(agent.rows.length!==6)throw new Error('Incomplete agent run')
const totals=Object.fromEntries(['off','both'].map(mode=>[mode,Object.fromEntries(['passed','inputTokens','outputTokens','searches','reads','totalMs','cost','jevCost']
  .map(k=>[k,agent.rows.filter(r=>r.mode===mode).reduce((s,r)=>s+r[k],0)]))]))
const result={snapshots:experiments.map(e=>e.snapshot),builds:experiments.map(e=>e.build),stageRuns:rows.length,summary,agent:totals,
  agentInputReduction:1-totals.both.inputTokens/totals.off.inputTokens,research:{test:research.test,ablations:research.ablations,usage:research.usage}}
await fs.writeFile(path.join(dir,'summary.json'),JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify(result,null,2))
