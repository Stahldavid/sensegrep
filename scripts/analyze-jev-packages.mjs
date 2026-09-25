import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import {factSourceMetrics} from './jev-reviewed-facts.mjs'
const dir=process.argv[2]
if(!dir) throw Error('Usage: node scripts/analyze-jev-packages.mjs <evaluation-directory>')
const read=p=>JSON.parse(readFileSync(p,'utf8'))
const splits=['dev','validation','reserved'].filter(s=>existsSync(`${dir}/${s}.json`)).map(s=>read(`${dir}/${s}.json`))
if(new Set(splits.map(s=>JSON.stringify(s.config))).size!==1) throw Error('Incompatible configurations')
const bindings=read('scripts/fixtures/jev-v9-fact-bindings.json').bindings
const rows=splits.flatMap(s=>s.rows.map(r=>({...r,split:s.split,...factSourceMetrics(r,bindings)})))
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null
const arms=Object.fromEntries([...new Set(rows.map(r=>r.arm))].map(arm=>{
  const group=rows.filter(r=>r.arm===arm),positive=group.filter(r=>r.answerExistsInScope)
  return [arm,{queries:group.length,failed:group.filter(r=>r.status==='failed').length,
    allFactSources:positive.filter(r=>r.allFactSources).length,positiveQueries:positive.length,
    macroFamilyFactSourceCoverage:mean([...new Set(positive.map(r=>r.group))].map(g=>mean(positive.filter(r=>r.group===g).map(r=>r.factSourceCoverage??0)))),
    meanMs:mean(group.map(r=>r.ms).filter(Number.isFinite)),direct:group.filter(r=>r.verdict==='direct-evidence').length,
    unsupportedDirectProxy:group.filter(r=>r.verdict==='direct-evidence'&&!r.allFactSources).map(r=>r.id),
    negativeVerdicts:group.filter(r=>!r.answerExistsInScope).map(r=>({id:r.id,verdict:r.verdict??r.jev?.packetStatus??'not-assessed'}))}]
}))
// Training/audit rows contain outcomes, never feed them back into the live prompt.
// They are grouped by query family; these consumed queries are regression data.
const packetRows=rows.filter(r=>r.jev?.packages).flatMap(r=>r.jev.packages.selected.map(p=>({query:r.id,group:r.group,split:r.split,
  root:p.root,sources:p.sources,bounded:p.bounded,sourceCount:p.sources.length,
  retainedReferenceSymbols:r.references?.filter(ref=>ref.present&&p.sources.some(s=>s.startsWith(ref.file+':')&&s.endsWith(':'+ref.symbol))).map(ref=>`${ref.file}:${ref.symbol}`),
  contextFactSourceCoverage:r.factSourceCoverage,contextVerdict:r.verdict??r.jev.packetStatus})))
const expected=(splits[0].config.caseCount??30)*splits[0].config.arms.length
const result={complete:rows.length===expected && new Set(rows.map(r=>r.id+':'+r.arm)).size===expected,config:splits[0].config,arms,
  cases:rows.map(({id,arm,sourceRecall,factSourceCoverage,allFactSources,verdict})=>({id,arm,sourceRecall,factSourceCoverage,allFactSources,verdict})),
  caveat:'Reused regression queries; source coverage is not semantic accuracy. Package audit rows are not labels for model training without independent review.'}
writeFileSync(`${dir}/summary.json`,JSON.stringify(result,null,2)+'\n')
writeFileSync(`${dir}/package-audit.json`,JSON.stringify(packetRows,null,2)+'\n')
console.log(JSON.stringify({complete:result.complete,arms},null,2))
