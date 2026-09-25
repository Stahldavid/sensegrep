// Replay decisions only. No network calls; never opens validation/reserved labels.
import {readFileSync,writeFileSync} from 'node:fs'
import path from 'node:path'
import {hash} from './evaluate-jev-reviewed.mjs'
import {factSourceMetrics} from './jev-reviewed-facts.mjs'
const dir=path.resolve(process.argv[2]??'')
const dev=JSON.parse(readFileSync(path.join(dir,'dev.json'),'utf8'))
if(dev.split!=='dev' || dev.rows.length!==45)throw Error('Complete 15 x 3 development comparison required')
const bindings=JSON.parse(readFileSync('scripts/fixtures/jev-v9-fact-bindings.json','utf8')).bindings
const rows=dev.rows.filter(r=>r.arm!=='local').map(r=>({...r,...factSourceMetrics(r,bindings)}))
const verdict=(row,policy)=>{
  const assessment=row.evidenceAssessment
  if(policy==='strict' || !assessment || assessment.verdict==='conflicting-evidence')return row.verdict
  const covered=assessment.fullyAssessed && assessment.coverage?.length && assessment.coverage.every(a=>a.witnesses?.length)
  const pending=row.jev?.dependencyCheck?.pending
  return covered && Array.isArray(pending) && !pending.length?'direct-evidence':row.verdict
}
const metrics=policy=>({policy,
  unsupportedDirectProxy:rows.filter(r=>verdict(r,policy)==='direct-evidence' && !r.allFactSources).length,
  acceptedCompleteReferenceSets:rows.filter(r=>verdict(r,policy)==='direct-evidence' && r.allFactSources).length,
  changed:rows.filter(r=>verdict(r,policy)!==r.verdict).map(r=>({id:r.id,arm:r.arm,referenceSetComplete:r.completeReferenceSet})),
})
const strict=metrics('strict'),advisory=metrics('inspection-advisory')
// An unvalidated change is not promoted when it worsens even this conservative proxy.
const selected=advisory.unsupportedDirectProxy<=strict.unsupportedDirectProxy && advisory.acceptedCompleteReferenceSets>strict.acceptedCompleteReferenceSets?'inspection-advisory':'strict'
const budget=JSON.parse(readFileSync(path.join(dir,'budget.json'),'utf8'))
const disagreements=[]
for(const request of budget.requests)for(const [key,a] of Object.entries(request.answers??{})) {
  const match=key.match(/^(c\d+)_aspect(\d+)$/)
  if(!match || a.type!=='choice' || a.choice!=='supports' || a.probabilities.supports<.8)continue
  const gap=request.answers[`${match[1]}_gap${match[2]}`],location=request.answers[`${match[1]}_location${match[2]}`]
  if(location?.choice && location.choice!=='none' && gap && (gap.choice!=='none'||gap.probabilities.none<.8))disagreements.push({queryHash:request.queryHash,requestHash:request.requestHash,gap:gap.choice,noGapMass:gap.probabilities.none})
}
const result={developmentHash:hash(readFileSync(path.join(dir,'dev.json'))),strict,advisory,selected,
  promotion:'shadow-only',doubleVetoDisagreements:disagreements,
  capturedRequests:budget.requests.filter(r=>r.answers).length,totalRequests:budget.requests.length,
  note:'Reference-set coverage is a proxy, not a semantic correctness label. Double-veto replay covers only captured requests. No threshold chosen from validation or reserved cases.'}
writeFileSync(path.join(dir,'calibration.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'})
const frozen=JSON.parse(readFileSync(path.join(dir,'frozen.json')))
frozen.shadowPolicy={selected,calibrationHash:hash(JSON.stringify(result)),runtimeUnchanged:true}
frozen.factBindingsHash=hash(readFileSync('scripts/fixtures/jev-v9-fact-bindings.json'))
writeFileSync(path.join(dir,'frozen.json'),JSON.stringify(frozen,null,2)+'\n')
console.log(JSON.stringify({strict,advisory,selected,doubleVetoDisagreements:disagreements.length}))
