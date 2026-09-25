import {readFileSync,writeFileSync} from 'node:fs'
const files=process.argv.slice(2)
if(!files.length)throw new Error('Pass evaluation JSON files')
const median=xs=>{const a=[...xs].sort((a,b)=>a-b);return a.length?(a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2:null}
const runs=files.map(file=>{
  const data=JSON.parse(readFileSync(file,'utf8'))
  return {file,build:data.build,casesHash:data.casesHash,snapshot:data.snapshot,arms:Object.fromEntries(['local','all'].map(arm=>{
    const rows=data.rows.filter(r=>r.arm===arm),positive=rows.filter(r=>!r.negative),negative=rows.filter(r=>r.negative)
    return [arm,{queries:rows.length,positive:positive.length,completeSymbols:positive.filter(r=>r.allRequired).length,
      completeStrictSymbols:positive.filter(r=>r.strictCoverage?.allRequired).length,
      completeFacts:positive.filter(r=>r.allFacts).length,negatives:negative.length,correctAbstentions:negative.filter(r=>r.weakEvidence).length,
      failed:rows.filter(r=>r.status==='failed').length,medianMs:median(rows.map(r=>r.ms).filter(Number.isFinite)),
      requests:rows.reduce((n,r)=>n+(r.requests??0),0),cost:rows.reduce((n,r)=>n+(r.cost??0),0),
      unverified:rows.filter(r=>r.packetStatus==='not-assessed').length,
      cases:rows.map(r=>({name:r.name,symbols:r.allRequired,facts:r.allFacts,verdict:r.verdict,sourceTokens:r.estimatedContextTokens}))}]
  }))}
})
console.log(JSON.stringify(runs,null,2))
