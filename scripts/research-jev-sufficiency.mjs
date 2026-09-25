// Manual feature discovery, Jev-only measurement, dev-only selection and a frozen
// test pass. No proposer model. Artifacts are shadow policies, never runtime config.
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {evaluateWithJev,assessJevPacket,JEV_VERSION} from '../packages/core/dist/tool/jev.js'
import {buildWitnesses} from '../packages/core/dist/tool/jev-witness.js'
import {witnessCases} from './fixtures/jev-witness-cases.mjs'

export const QUESTIONS={
  answer_present:{type:'noul',instructions:'Does supplied source explicitly implement the answer requested by query? Names and topic resemblance alone are insufficient.'},
  delegation_closed:{type:'noul',instructions:'Are implementations of the calls needed to answer query supplied in this source set? False when the answer depends on an absent definition. Incidental calls unrelated to the requested fact do not need expansion.'},
  value_grounded:{type:'noul',instructions:'Can the requested answer be determined using only the supplied source and its explicit dependency links? A constant in an unrelated file cannot provide the value used by a caller. Do not assume imports or hidden definitions.'},
}
export function measure(records) {
  const groups=[...new Set(records.map(r=>r.group))]
  const perGroup=groups.map(group=>{
    const rows=records.filter(r=>r.group===group),pos=rows.filter(r=>r.expectedComplete),neg=rows.filter(r=>!r.expectedComplete)
    return {falseComplete:neg.length?neg.filter(r=>r.accepted).length/neg.length:0,
      trueComplete:pos.length?pos.filter(r=>r.accepted).length/pos.length:0}
  })
  const outcome=field=>{
    const means=groups.map(group=>records.filter(r=>r.group===group && Number.isFinite(r[field])))
      .filter(rows=>rows.length).map(rows=>rows.reduce((sum,r)=>sum+(r.accepted?r[field]:0),0)/rows.length)
    return means.length?means.reduce((a,b)=>a+b,0)/means.length:null
  }
  return {falseComplete:perGroup.reduce((s,r)=>s+r.falseComplete,0)/Math.max(1,groups.length),
    trueComplete:perGroup.reduce((s,r)=>s+r.trueComplete,0)/Math.max(1,groups.length),groups:groups.length,
    usableRequirementCoverage:outcome('requirementCoverage'),usableDependencyRecall:outcome('dependencyRecall'),
    cases:records.length,unavailable:records.filter(r=>r.available===false).length}
}
export function selectPolicy(dev, questions=QUESTIONS) {
  if(dev.some(r=>r.split!=='dev')) throw Error('Development-only policy selection')
  const names=Object.entries(questions).map(([id,q])=>q.type==='score'?`${id}_mean`:id),trials=[]
  if(!dev.length || !names.length || names.length>10) throw Error("Need dev records and 1-10 screened questions per round")
  for(let mask=1;mask<(1<<names.length);mask++) for(const threshold of [.65,.8,.9]) {
    const features=names.filter((_,i)=>mask&(1<<i))
    const metrics=measure(dev.map(r=>({...r,accepted:accepts(r,{features,threshold})})))
    trials.push({features,threshold,metrics})
  }
  // False sufficiency is primary, then correct coverage, then fewer questions.
  // No pseudo-probability blend; no held-out labels enter this decision.
  return trials.sort((a,b)=>a.metrics.falseComplete-b.metrics.falseComplete
    || (b.metrics.usableRequirementCoverage ?? 0)-(a.metrics.usableRequirementCoverage ?? 0)
    || (b.metrics.usableDependencyRecall ?? 0)-(a.metrics.usableDependencyRecall ?? 0)
    || b.metrics.trueComplete-a.metrics.trueComplete
    || a.features.length-b.features.length || b.threshold-a.threshold)[0]
}
export function accepts(record,policy) {
  // Features must agree within ONE directed source set, never maxima from unrelated witnesses.
  return !!record.available && (record.witnessFeatures ?? [record.features]).some(features=>
    policy.features.every(k=>Number.isFinite(features?.[k]) && features[k]>=policy.threshold))
}
export async function main(argv) {
  if(!argv.includes('--live')) throw Error('Explicit --live required')
  const output=path.resolve(argv[argv.indexOf('--output')+1] || '')
  if(!argv.includes('--output')) throw Error('--output required')
  mkdirSync(output,{recursive:true})
  const proposal=argv.includes('--questions')?JSON.parse(readFileSync(argv[argv.indexOf('--questions')+1],'utf8')):null
  const questions=proposal?.questions ?? QUESTIONS
  const questionHash=createHash('sha256').update(JSON.stringify(questions)).digest('hex')
  const records=[],runtime=[]
  const save=(name,value)=>writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n')
  if(argv.includes('--runtime-only')) {
    for(const c of witnessCases()) {
      const assessed=await assessJevPacket(c.query,c.rows,{mode:'evidence',timeoutMs:8000},{cache:false})
      runtime.push({id:c.id,group:c.group,split:c.split,expectedComplete:c.expectedComplete,accepted:assessed.verdict==='direct-evidence',
        available:assessed.fullyAssessed,verdict:assessed.verdict,coverage:assessed.coverage,diagnostics:assessed.evaluation})
      save('runtime.json',{contract:JEV_VERSION,runtime,metrics:measure(runtime),note:'Reused regression cases, not an untouched holdout.'})
      console.log(JSON.stringify({id:c.id,verdict:assessed.verdict,expectedComplete:c.expectedComplete}))
    }
    return
  }
  const measureCases=async split=>{
    for(const c of witnessCases(split)) {
      if(split==='test' && artifact.developmentGroups.includes(c.group)) throw Error('Group leakage before inference')
      const witnesses=await buildWitnesses(c.rows)
      const result=await evaluateWithJev(c.query,witnesses.map(w=>w.row),{mode:'evidence',featureQuestions:questions,timeoutMs:8000},{cache:false})
      const witnessFeatures=[...result.scores.values()].map(s=>s.dimensions ?? {})
      records.push({id:c.id,group:c.group,split,expectedComplete:c.expectedComplete,available:result.diagnostics.status==='complete',
        requirementCoverage:c.requirementCoverage,dependencyRecall:c.dependencyRecall,contextTokens:c.contextTokens,
        witnessFeatures,features:witnessFeatures[0] ?? {},diagnostics:result.diagnostics})
      const assessed=await assessJevPacket(c.query,c.rows,{mode:'evidence',timeoutMs:8000},{cache:false})
      runtime.push({id:c.id,group:c.group,split,expectedComplete:c.expectedComplete,accepted:assessed.verdict==='direct-evidence',
        available:assessed.fullyAssessed,verdict:assessed.verdict,coverage:assessed.coverage,diagnostics:assessed.evaluation})
      save('measurements.json',{contract:JEV_VERSION,questionHash,records,runtime})
      console.log(JSON.stringify({id:c.id,verdict:assessed.verdict,expectedComplete:c.expectedComplete}))
    }
  }
  if(!argv.includes('--test-frozen')) {
    await measureCases('dev')
    const policy=selectPolicy(records,questions)
    save('frozen-policy.json',{contract:JEV_VERSION,shadow:true,questions,policy,developmentGroups:[...new Set(records.map(r=>r.group))]})
    return // Manual review/revision rounds happen before any held-out measurement.
  }
  const artifact=JSON.parse(readFileSync(path.join(output,'frozen-policy.json'),'utf8'))
  if(artifact.contract!==JEV_VERSION || JSON.stringify(artifact.questions)!==JSON.stringify(questions)) throw Error('Frozen contract mismatch')
  const policy=artifact.policy
  writeFileSync(path.join(output,'holdout-consumed.json'),JSON.stringify({contract:JEV_VERSION}),{flag:'wx'})
  const frozenHash=createHash('sha256').update(readFileSync(path.join(output,'frozen-policy.json'))).digest('hex')
  await measureCases('test')
  const test=records.filter(r=>r.split==='test')
  if(test.some(r=>artifact.developmentGroups.includes(r.group))) throw Error('Group leakage')
  if(createHash('sha256').update(readFileSync(path.join(output,'frozen-policy.json'))).digest('hex')!==frozenHash) throw Error('Policy changed during test')
  save('summary.json',{contract:JEV_VERSION,policyHash:frozenHash,shadow:true,
    development:policy.metrics,test:measure(test.map(r=>({...r,accepted:accepts(r,policy)}))),
    runtime:{dev:measure(runtime.filter(r=>r.split==='dev')),test:measure(runtime.filter(r=>r.split==='test'))},
    note:'Synthetic source-reviewed packet tests. Test groups excluded from selection. This is not a production quality estimate; no learned policy promoted.'})
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) await main(process.argv.slice(2))
