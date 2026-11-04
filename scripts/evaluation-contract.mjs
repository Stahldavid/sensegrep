import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, lstatSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SHA = /^[a-f0-9]{40,64}$/
const SHA256 = /^[a-f0-9]{64}$/
const text = value => typeof value === 'string' && value.trim().length > 0
const fail = message => { throw new Error(`Evaluation contract: ${message}`) }
export function stableHash(value) {
  const canonical = v => Array.isArray(v) ? v.map(canonical)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])) : v
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

/** Groups are repository + question family across snapshots. A later snapshot
 * of the same family is not a fresh holdout. This validates declared grouping;
 * it cannot prove that an author has never inspected private labels. */
export function validateEvaluationManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== 1 || !text(manifest.id)) fail('schemaVersion=1 and id required')
  if (!SHA.test(manifest.codeSha ?? '')) fail('full code commit identity required')
  if (!text(manifest.indexSnapshot) || !SHA256.test(manifest.indexConfigHash ?? '')) fail('frozen index identity required')
  if (!text(manifest.model?.alias) || !text(manifest.model?.revision)) fail('model alias and resolved revision required')
  if (!Array.isArray(manifest.cases) || !manifest.cases.length) fail('nonempty cases required')
  const ids = new Set(), groups = new Map()
  const counts = {dev:0,regression:0,holdout:0}
  for (const row of manifest.cases) {
    if (!text(row.id) || ids.has(row.id)) fail('duplicate or missing case ID')
    ids.add(row.id)
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(row.repository??'') || !SHA.test(row.repositorySha ?? '') || !text(row.family) || !text(row.query)) fail(`missing source/group identity for ${row.id}`)
    if (!Object.hasOwn(counts,row.split)) fail(`invalid split for ${row.id}`)
    counts[row.split]++
    const group = `${row.repository.toLowerCase()}\0${row.family}`
    const previous = groups.get(group)
    if (previous && previous !== row.split) fail(`group leakage across ${previous}/${row.split}: ${row.id}`)
    groups.set(group,row.split)
    if (typeof row.negative !== 'boolean' || row.reviewed !== true) fail(`reviewed labels and explicit negative flag required for ${row.id}`)
    if (!Array.isArray(row.acceptableSourceSets)) fail(`acceptable source sets required for ${row.id}`)
    if (row.negative && row.acceptableSourceSets.length) fail(`negative case cannot require positive source sets: ${row.id}`)
    if (!row.negative && (!row.acceptableSourceSets.length || row.acceptableSourceSets.some(set=>!Array.isArray(set)||!set.length||set.some(id=>!text(id))||new Set(set).size!==set.length))) {
      fail(`nonempty independently reviewed alternative sets required for ${row.id}`)
    }
  }
  return {cases:ids.size,groups:groups.size,splits:counts,manifestHash:stableHash(manifest)}
}

export function referenceCoverage(acceptableSourceSets, sourceIds) {
  if (!Array.isArray(sourceIds)) return {status:'not-assessed',recall:null,complete:false,alternative:null}
  if (!acceptableSourceSets.length) return {status:'not-applicable',recall:null,complete:false,alternative:null}
  if (acceptableSourceSets.some(set=>!Array.isArray(set)||!set.length)) fail('empty positive reference set')
  const sources = new Set(sourceIds)
  const coverage = acceptableSourceSets.map((set,alternative)=>({alternative,recall:set.filter(id=>sources.has(id)).length/set.length,complete:set.every(id=>sources.has(id))}))
  const best = coverage.sort((a,b)=>Number(b.complete)-Number(a.complete)||b.recall-a.recall||a.alternative-b.alternative)[0]
  return {status:'assessed',...best}
}

/** Report observed losses without claiming causality when stage telemetry is absent.
 * `universe` must include all expanded candidates, not only the first vector batch. */
export function classifyRetrievalLoss(reference, stages) {
  const order=['universe','nominated','assessed','selected','emitted']
  const metrics=Object.fromEntries(order.map(stage=>[stage,referenceCoverage(reference.acceptableSourceSets,stages?.[stage])]))
  if (reference.negative) return {classification:'negative-control',metrics}
  if (metrics.emitted.complete) return {classification:'reference-set-present',metrics}
  if (order.some(stage=>metrics[stage].status==='not-assessed')) return {classification:'insufficient-telemetry',metrics}
  const finalLoss=order.find(stage=>!metrics[stage].complete)
  return {classification:`reference-loss:${finalLoss}`,metrics,
    interpretation:'Observed reference-set coverage, not answer accuracy or a causal attribution without replay'}
}

export function summarizeReviewedRun(manifest, results) {
  validateEvaluationManifest(manifest)
  const known = new Set(manifest.cases.map(row=>row.id)), byId=new Map()
  for (const row of results) {
    if (!known.has(row.id) || byId.has(row.id)) fail('unknown or duplicate result ID')
    byId.set(row.id,row)
  }
  const rows=manifest.cases.map(reference=>{
    const result=byId.get(reference.id)
    const observed=classifyRetrievalLoss(reference,result?.stages)
    return {id:reference.id,split:reference.split,negative:reference.negative,
      executionStatus:result?.status??'missing',verdict:result?.verdict??'not-assessed',...observed}
  })
  const positives=rows.filter(row=>!row.negative)
  return {manifestHash:stableHash(manifest),total:rows.length,
    failedOrMissing:rows.filter(row=>row.executionStatus!=='complete').length,
    positiveQueries:positives.length,completeReferenceSets:positives.filter(row=>row.metrics.emitted.complete).length,
    unsupportedDirectProxy:positives.filter(row=>row.verdict==='direct-evidence'&&!row.metrics.emitted.complete).length,
    note:'All registered cases remain in the denominator. Reference coverage and unsupported-direct proxies are not semantic accuracy.',rows}
}

export function freezeEvaluationManifest(manifest, baseDirectory, output) {
  const validation=validateEvaluationManifest(manifest)
  const root=realpathSync(baseDirectory)
  const artifacts=(manifest.artifacts??[]).map(artifact=>{
    if (!text(artifact.path) || path.isAbsolute(artifact.path)) fail('artifact paths must be relative')
    const file=path.resolve(root,artifact.path),relative=path.relative(root,file)
    if (relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative)) fail('artifact escapes manifest directory')
    const stat=lstatSync(file)
    if (!stat.isFile()||stat.isSymbolicLink()||stat.size>64*1024*1024) fail('artifact must be a bounded regular file')
    const canonical=realpathSync(file),actualRelative=path.relative(root,canonical)
    if (actualRelative==='..'||actualRelative.startsWith(`..${path.sep}`)||path.isAbsolute(actualRelative)) fail('artifact resolves outside manifest directory')
    const sha256=createHash('sha256').update(readFileSync(canonical)).digest('hex')
    if (artifact.sha256!==undefined && artifact.sha256!==sha256) fail(`artifact hash changed: ${artifact.path}`)
    return {path:artifact.path,sha256,bytes:stat.size}
  })
  const frozen={...manifest,artifacts,registeredManifestHash:validation.manifestHash}
  writeFileSync(output,JSON.stringify(frozen,null,2)+'\n',{flag:'wx',mode:0o600})
  return {...validation,artifacts:artifacts.length,frozenHash:stableHash(frozen)}
}

if (process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const [operation,input,output]=process.argv.slice(2)
  if (!['validate','freeze'].includes(operation)||!input||operation==='freeze'&&!output) fail('use validate MANIFEST.json or freeze MANIFEST.json OUTPUT.json')
  const manifest=JSON.parse(readFileSync(input,'utf8'))
  console.log(JSON.stringify(operation==='freeze'?freezeEvaluationManifest(manifest,path.dirname(path.resolve(input)),output):validateEvaluationManifest(manifest)))
}
