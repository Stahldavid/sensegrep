import {readFileSync,writeFileSync} from 'node:fs'
const [input,output]=process.argv.slice(2)
if(!input||!output)throw new Error('Usage: summarize-jev-frozen.mjs input.json output.json')
const data=JSON.parse(readFileSync(input,'utf8')),rows=data.rows
const median=xs=>xs.length?[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)]:null
const arms=[]
for(const panel of ['noul','score','composite']) for(const batchSize of [1,5,10]) {
  const samples=rows.filter(r=>r.panel===panel&&r.batchSize===batchSize),normal=samples.filter(r=>r.variant==='normal')
  const drift={}
  for(const variant of ['reverse','distractor']) {
    const deltas=[]
    for(const r of samples.filter(r=>r.variant===variant && r.diagnostics.status==='complete')) {
      const base=normal.find(b=>b.name===r.name && b.diagnostics.status==='complete')
      if(!base)continue
      for(const s of r.scores) {const before=base.scores.find(b=>b.key===s.key);if(before)deltas.push(Math.abs(s.evidence-before.evidence))}
    }
    drift[variant]={pairs:deltas.length,meanAbsolute:deltas.length?deltas.reduce((a,b)=>a+b,0)/deltas.length:null,max:deltas.length?Math.max(...deltas):null}
  }
  arms.push({panel,batchSize,runs:samples.length,failures:samples.filter(r=>r.diagnostics.status!=='complete').length,
    positiveCases:normal.filter(r=>!r.negative).length,top5Hits:normal.filter(r=>!r.negative && r.rankings.score?.allRequired).length,
    absentFromPool:normal.filter(r=>!r.negative && r.baseline.poolRecall<1).map(r=>r.name),
    negativeMaxEvidence:Math.max(0,...normal.filter(r=>r.negative).map(r=>r.rankings.score?.maxEvidence??0)),
    medianMs:median(samples.map(r=>r.ms)),cost:samples.reduce((s,r)=>s+r.diagnostics.cost,0),drift})
}
const result={fixtureHash:data.fixtureHash,snapshot:data.snapshot,independentCases:new Set(rows.map(r=>r.name)).size,
  groups:new Set(rows.map(r=>r.group)).size,runs:rows.length,totalCost:rows.reduce((s,r)=>s+r.diagnostics.cost,0),arms,
  note:'Repeated arms are not independent queries. Negative evidence scores are uncalibrated, not false-sufficiency rates.'}
writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result))
