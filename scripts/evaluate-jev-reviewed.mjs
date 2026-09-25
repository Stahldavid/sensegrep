import {readFileSync,writeFileSync,mkdirSync,readdirSync,existsSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import ts from 'typescript'

export const hash=v=>createHash('sha256').update(v).digest('hex')
export function referenceSource(root,ref) {
  const text=readFileSync(path.join(root,ref.file),'utf8'),ast=ts.createSourceFile(ref.file,text,ts.ScriptTarget.Latest,true)
  let node
  function visit(n){if((ts.isFunctionDeclaration(n)||ts.isVariableDeclaration(n)) && n.name?.getText(ast)===ref.symbol)node=n;ts.forEachChild(n,visit)}
  visit(ast);if(!node)throw Error(`Missing reference: ${ref.file}:${ref.symbol}`)
  return node.getText(ast).replaceAll('\r','')
}
export function sourceMetrics(c,results,root) {
  const refs=c.required.map(ref=>{
    const expected=referenceSource(root,ref)
    const rank=results.findIndex(r=>String(r.file).replaceAll('\\','/')===ref.file && !r.contentTruncated && !r.diagnostic?.contentTruncated
      && typeof r.content==='string' && r.content.replaceAll('\r','').includes(expected))+1
    return {...ref,present:rank>0,rank}
  })
  return {references:refs,sourceRecall:refs.length?refs.filter(r=>r.present).length/refs.length:null,
    completeReferenceSet:refs.length?refs.every(r=>r.present):null,
    // This is source coverage, NOT an LLM correctness grade. Facts remain separate labels for human review.
    factReview:c.expectedFacts.map(f=>({id:f.id,expected:f.description,status:refs.length && refs.every(r=>r.present)?'reference-set-present':'manual-review-required'}))}
}
export function summary(rows) {
  const arms=[...new Set(rows.map(r=>r.arm))]
  const mean=x=>x.length?x.reduce((a,b)=>a+b,0)/x.length:null
  return Object.fromEntries(arms.map(arm=>{
    const group=rows.filter(r=>r.arm===arm),eligible=group.filter(r=>r.answerExistsInScope)
    const familyMeans=[...new Set(eligible.map(r=>r.group))].map(g=>mean(eligible.filter(r=>r.group===g).map(r=>r.sourceRecall ?? 0)))
    return [arm,{queries:group.length,failed:group.filter(r=>r.status==='failed').length,
      completeReferenceSets:eligible.filter(r=>r.completeReferenceSet).length,positiveQueries:eligible.length,
      macroFamilySourceRecall:mean(familyMeans),meanMs:mean(group.map(r=>r.ms).filter(Number.isFinite)),
      falseCompleteProxy:group.filter(r=>r.verdict==='direct-evidence' && (!r.answerExistsInScope || r.completeReferenceSet===false)).length,
      direct:group.filter(r=>r.verdict==='direct-evidence').length,
      abstentionDespiteReferenceSet:group.filter(r=>r.completeReferenceSet && r.verdict && r.verdict!=='direct-evidence').length}]
  }))
}
export async function main(argv) {
  const flags={};for(let i=0;i<argv.length;i+=2)flags[argv[i].replace(/^--/,'')]=argv[i+1]
  for(const key of ['root','cases','output','split','arms'])if(!flags[key])throw Error(`--${key} required`)
  const dir=path.resolve(flags.output);mkdirSync(dir,{recursive:true})
  const manifest=JSON.parse(readFileSync(flags.cases,'utf8')),manifestHash=hash(readFileSync(flags.cases))
  const arms=flags.arms.split(',');if(arms.some(a=>!['local','selection','recovery'].includes(a)))throw Error('Invalid arms')
  if(!['dev','validation','reserved'].includes(flags.split))throw Error('Invalid split')
  const selected=manifest.cases.filter(c=>c.split===flags.split)
  const build=()=>hash(['packages/core/dist','packages/cli/dist'].flatMap(dir=>readdirSync(dir,{recursive:true})
    .filter(f=>f.endsWith('.js')).sort().map(f=>dir+'/'+f+hash(readFileSync(path.join(dir,f))))).join('|'))
  const buildHash=build()
  const candidates=Number(flags.candidates??12)
  if(!Number.isInteger(candidates)||candidates<1||candidates>80) throw Error('Invalid candidate limit')
  const timeoutMs=Number(flags.timeout??12000)
  if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>60000) throw Error('Invalid timeout')
  const config={manifestHash,buildHash,arms,maxTokens:4000,limit:5,timeoutMs,candidates,caseCount:manifest.cases.length}
  const frozen=path.join(dir,'frozen.json')
  if(flags.split==='dev') {
    if(existsSync(frozen))throw Error('Already frozen; do not retune here')
  } else {
    if(!existsSync(frozen))throw Error('Freeze after development before validation/reserved')
    if(JSON.stringify(JSON.parse(readFileSync(frozen)).config)!==JSON.stringify(config))throw Error('Frozen configuration mismatch')
  }
  const output=path.join(dir,flags.split+'.json')
  if(existsSync(output))throw Error('Split already consumed; use existing report')
  for(const c of selected)for(const source of c.sourceSnapshots)if(hash(readFileSync(path.join(flags.root,source.file)))!==source.sha256)throw Error('Source drift')
  const ledger=flags.budget ? path.resolve(flags.budget) : path.join(dir,'budget.json')
  if(arms.some(a=>a!=='local') && !existsSync(ledger))throw Error('Initialize aggregate budget before inference')
  const invoke=(args,paid=false)=>{
    const start=performance.now()
    const p=spawnSync(process.execPath,[...(paid?['--import',pathToFileURL(path.resolve('scripts/jev-budget-preload.mjs')).href]:[]),
      path.resolve('packages/cli/dist/main.js'),...args,'--root',flags.root,'--json','--log-format','none'],{
      windowsHide:true,encoding:'utf8',timeout:90000,maxBuffer:12*1024*1024,
      env:{...process.env,SENSEGREP_JEV_MODE:'off',SENSEGREP_JEV_CACHE:'false',SENSEGREP_RESEARCH_BUDGET:ledger}})
    if(p.status!==0)throw Error(p.error?.code==='ETIMEDOUT'?'cli-timeout':`cli-exit-${p.status}`)
    return {data:JSON.parse(p.stdout),ms:Math.round(performance.now()-start)}
  }
  const snapshot=invoke(['verify','--strict']).data.snapshotId
  if(!snapshot)throw Error('Index not verified')
  const rows=[]
  const save=()=>writeFileSync(output,JSON.stringify({config,snapshot,split:flags.split,rows,summary:summary(rows),
    note:'Source coverage proxy and manual fact-review queue. Reference-set absence is not proof that alternative implementations fail. No model judge.'},null,2)+'\n')
  save() // marks split consumed even if interrupted
  for(const c of selected)for(const arm of arms) {
    if(build()!==buildHash)throw Error('Build changed')
    if(arm!=='local') {
      const budget=JSON.parse(readFileSync(ledger))
      if(budget.blocked || budget.chargedUpperBoundUsd+budget.ceilingPerRequestUsd>budget.capUsd) {save();console.log('BUDGET_OR_PROVIDER_STOP');return}
    }
    let row={id:c.id,group:c.group,answerExistsInScope:c.answerExistsInScope,arm}
    try {
      const args=['context',c.query,'--max-tokens','4000','--limit','5','--no-shake','--diagnostic','--json-detail','full','--max-output-bytes','250000']
      if(c.scope.files)args.push('--include',c.scope.files.join(','))
      args.push('--jev',arm==='local'?'off':'both')
      if(arm!=='local')args.push('--jev-stages',arm==='selection'?'rerank,evidence':'rerank,evidence,recovery','--jev-timeout',String(timeoutMs),'--jev-candidates',String(candidates))
      const {data,ms}=invoke(args,arm!=='local')
      if((data.index?.snapshotId??data.diagnostic?.index?.snapshotId)!==snapshot)throw Error('Snapshot changed')
      row={...row,status:data.status,ms,...sourceMetrics(c,data.results??[],flags.root),verdict:data.evidenceAssessment?.verdict,
        evidenceAssessment:data.evidenceAssessment,jev:data.jev,results:(data.results??[]).map(r=>({file:r.file,symbol:r.symbol,lines:r.lines,content:r.content,contentTruncated:r.contentTruncated})),
        budget:data.budget}
    } catch(e) {row={...row,status:'failed',error:e.message}}
    rows.push(row);save();console.log(JSON.stringify({id:c.id,arm,status:row.status,recall:row.sourceRecall,verdict:row.verdict,ms:row.ms}))
  }
  if(invoke(['verify','--strict']).data.snapshotId!==snapshot)throw Error('Index changed')
  if(flags.split==='dev')writeFileSync(frozen,JSON.stringify({config,developmentSummary:summary(rows),decision:'Freeze current contract for validation; no learned weights promoted.'},null,2)+'\n',{flag:'wx'})
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main(process.argv.slice(2))
