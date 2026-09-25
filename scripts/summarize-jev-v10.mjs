import {readFileSync,writeFileSync} from 'node:fs'
import {factSourceMetrics} from './jev-reviewed-facts.mjs'

const dir='docs/evaluations/jev-v10-optimized-2026-09-25'
const read=p=>JSON.parse(readFileSync(p,'utf8'))
const bindings=read('scripts/fixtures/jev-v9-fact-bindings.json').bindings
const splits=['dev','validation','reserved'].map(split=>read(`${dir}/${split}.json`))
if(splits.map(x=>x.rows.length).join(',')!=='45,15,30') throw Error('Incomplete evaluation')
if(new Set(splits.map(x=>JSON.stringify(x.config))).size!==1) throw Error('Configuration drift')
const rows=splits.flatMap(x=>x.rows.map(r=>({...r,split:x.split,...factSourceMetrics(r,bindings)})))
const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length
const arms=Object.fromEntries(['local','selection','recovery'].map(arm=>{
  const group=rows.filter(r=>r.arm===arm),positive=group.filter(r=>r.answerExistsInScope)
  return [arm,{queries:group.length,failures:group.filter(r=>r.status==='failed').length,
    allFactSources:positive.filter(r=>r.allFactSources).length,positiveQueries:positive.length,
    macroFamilyFactSourceCoverage:mean([...new Set(positive.map(r=>r.group))].map(f=>mean(positive.filter(r=>r.group===f).map(r=>r.factSourceCoverage??0)))),
    meanMs:mean(group.map(r=>r.ms).filter(Number.isFinite)),
    direct:group.filter(r=>r.verdict==='direct-evidence').length,
    unsupportedDirectProxy:group.filter(r=>r.verdict==='direct-evidence'&&!r.allFactSources).map(r=>r.id),
    negativeVerdicts:group.filter(r=>!r.answerExistsInScope).map(r=>({id:r.id,verdict:r.verdict??'not-assessed'}))}]
}))
const ledger=read('docs/evaluations/jev-v9-reviewed-2026-09-25/budget.json')
const synthetic=read('docs/evaluations/jev-v10-contract-2026-09-25/results.json')
const result={config:splits[0].config,arms,budget:{capUsd:ledger.capUsd,chargedUpperBoundUsd:ledger.chargedUpperBoundUsd,blocked:ledger.blocked},
  controlled:{cases:synthetic.length,correct:synthetic.filter(r=>r.accepted===r.expectedComplete).length},
  perCase:rows.map(({id,arm,split,sourceRecall,factSourceCoverage,allFactSources,verdict,ms})=>({id,arm,split,sourceRecall,factSourceCoverage,allFactSources,verdict,ms})),
  limitation:'Reused regression cases. Source provenance is not independent semantic correctness. Latency is not isolated from host/provider load.'}
writeFileSync(`${dir}/summary.json`,JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify({arms,budget:result.budget,controlled:result.controlled},null,2))
