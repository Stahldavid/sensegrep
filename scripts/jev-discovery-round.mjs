// Offline, manually authored AutoResearch rounds. Never calls a model or reads test labels.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import path from 'node:path'
import {selectPolicy,measure,accepts} from './research-jev-sufficiency.mjs'

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const mean=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null
export function outcomeMetrics(records,policy) {
  const judged=records.map(r=>({...r,accepted:accepts(r,policy)}))
  const groups=[...new Set(records.map(r=>r.group))]
  const groupMean=fn=>mean(groups.map(g=>mean(records.filter(r=>r.group===g).map(fn).filter(Number.isFinite))).filter(Number.isFinite))
  return {...measure(judged),excessiveAbstention:1-measure(judged).trueComplete,
    // Missing labels remain unavailable rather than invented perfect scores.
    requirementCoverage:groupMean(r=>r.requirementCoverage),dependencyRecall:groupMean(r=>r.dependencyRecall),
    contextTokens:groupMean(r=>r.contextTokens),latencyMs:groupMean(r=>r.diagnostics?.elapsedMs)}
}
export function discoveryRound({records,questions,screening,previous}) {
  if(!records.length || records.some(r=>r.split!=='dev')) throw Error('Only development observations may enter discovery')
  const names=Object.keys(questions)
  for(const name of names) {
    const screen=screening?.[name]
    if(!screen || !['answerableFromState','atomic','applicable','variable'].every(k=>screen[k]===true)
      || !screen.rationale?.trim()) throw Error(`Manual screening required: ${name}`)
    if(!questions[name]?.instructions?.trim()) throw Error('Question instructions required')
  }
  const policy=selectPolicy(records,questions)
  const groups=[...new Set(records.map(r=>r.group))]
  if(groups.length<3) throw Error('At least three independent development groups required')
  const heldOut=[]
  for(const group of groups) {
    const trained=selectPolicy(records.filter(r=>r.group!==group),questions)
    heldOut.push(...records.filter(r=>r.group===group).map(r=>({...r,accepted:accepts(r,trained)})))
  }
  const groupedValidation=measure(heldOut)
  const errors=records.filter(r=>accepts(r,policy)!==r.expectedComplete).map(r=>({
    id:r.id,group:r.group,error:accepts(r,policy)?'false-complete':'excessive-abstention',
    features:r.witnessFeatures ?? [r.features],missingRequirements:r.missingRequirements ?? null,
    missingDependencies:r.missingDependencies ?? null,
  }))
  const revisions=previous ? {added:names.filter(k=>!previous.questions[k]),
    removed:Object.keys(previous.questions).filter(k=>!questions[k]),
    revised:names.filter(k=>previous.questions[k] && digest(previous.questions[k])!==digest(questions[k]))} : {added:names,removed:[],revised:[]}
  const prior=previous?.groupedValidation
  const improved=!prior || groupedValidation.falseComplete<prior.falseComplete ||
    groupedValidation.falseComplete===prior.falseComplete && groupedValidation.trueComplete>prior.trueComplete
  return {shadow:true,questions,screening,policy,revisions,groupedValidation,metrics:outcomeMetrics(records,policy),errors,
    developmentGroups:groups,measurementHash:digest(records),parentHash:previous?digest(previous):null,
    recommendation:improved?'review-dev-errors-before-next-round':'plateau-review-or-stop',
    note:'Packet sufficiency policy only. Coverage, dependency recall, tokens and latency are separately reported; unavailable outcome labels block claims of end-to-end improvement. No runtime promotion.'}
}
export function main(argv) {
  const arg=name=>{const i=argv.indexOf(name);if(i<0 || !argv[i+1]) throw Error(`${name} required`);return argv[i+1]}
  const observations=JSON.parse(readFileSync(arg('--measurements'),'utf8'))
  const proposal=JSON.parse(readFileSync(arg('--proposal'),'utf8'))
  if(observations.questionHash!==digest(proposal.questions)) throw Error('Measurements must match exact proposed questions')
  const previous=argv.includes('--previous')?JSON.parse(readFileSync(arg('--previous'),'utf8')):undefined
  const result=discoveryRound({records:observations.records,questions:proposal.questions,screening:proposal.screening,previous})
  const output=path.resolve(arg('--output'));mkdirSync(path.dirname(output),{recursive:true})
  writeFileSync(output,JSON.stringify({...result,contract:observations.contract},null,2)+'\n',{flag:'wx'})
  console.log(JSON.stringify({output,recommendation:result.recommendation,errors:result.errors.length}))
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2))
