// Full factorial stage ablation. Real CLI, frozen index, source-free report, failures retained.
import {spawnSync} from 'node:child_process'
import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs'
import {createHash} from 'node:crypto'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {matchesSource,factMetrics} from './jev-quality-metrics.mjs'
export const ARMS={local:[],rerank:['rerank'],evidence:['evidence'],recovery:['recovery'],
  'rerank+evidence':['rerank','evidence'],'rerank+recovery':['rerank','recovery'],
  'evidence+recovery':['evidence','recovery'],all:['rerank','evidence','recovery'],
  experimental:['rerank','evidence','recovery']}
export const PROMOTION_ARMS={...ARMS,verification:ARMS.all,deep:ARMS.all}
export function coverageMetrics(required,results,k=5) {
  const ranks=required.map(e=>results.findIndex(r=>matchesSource(r,e))+1)
  const hits=ranks.filter(r=>r>0&&r<=k).length
  const dcg=ranks.filter(r=>r>0&&r<=k).reduce((s,r)=>s+1/Math.log2(r+1),0)
  const ideal=Array.from({length:Math.min(k,required.length)},(_,i)=>1/Math.log2(i+2)).reduce((a,b)=>a+b,0)
  return {requiredRecall:required.length?hits/required.length:null,allRequired:required.length?hits===required.length:null,
    mrr:ranks.some(r=>r>0)?1/Math.min(...ranks.filter(r=>r>0)):0,ndcg:ideal?dcg/ideal:null,ranks}
}
export async function main(argv) {
  const flags={};for(let i=0;i<argv.length;i+=2)flags[argv[i].replace(/^--/,'')]=argv[i+1]
  for(const k of ['root','cases','output'])if(!flags[k])throw new Error(`Required --${k}`)
  const cli=path.resolve('packages/cli/dist/main.js'),rows=[]
  const binaryHash=()=>{
    const hash=createHash('sha256')
    for(const dir of ['packages/core/dist','packages/cli/dist'])for(const file of readdirSync(dir,{recursive:true}).filter(f=>f.endsWith('.js')).sort()) {
      hash.update(dir+'/'+file);hash.update(readFileSync(path.join(dir,file)))
    }
    return hash.digest('hex')
  }
  const build=binaryHash()
  const invoke=args=>{
    if(binaryHash()!==build)throw new Error('build-changed')
    const start=performance.now(),p=spawnSync(process.execPath,[cli,...args,'--root',flags.root,'--json','--log-format','none'],
      {windowsHide:true,encoding:'utf8',timeout:90000,maxBuffer:8*1024*1024,env:{...process.env,SENSEGREP_JEV_CACHE:'false'}})
    if(p.status!==0)throw new Error(p.error?.code==='ETIMEDOUT'?'cli-timeout':`cli-exit-${p.status}`)
    return {data:JSON.parse(p.stdout),ms:Math.round(performance.now()-start)}
  }
  const snapshot=invoke(['verify','--strict']).data.snapshotId
  if(!snapshot)throw new Error('Missing snapshot')
  mkdirSync(path.dirname(path.resolve(flags.output)),{recursive:true})
  const cases=JSON.parse(readFileSync(flags.cases,'utf8')),arms=flags.arms?flags.arms.split(','):Object.keys(ARMS)
  if(new Set(arms).size!==arms.length||arms.some(a=>!Object.hasOwn(PROMOTION_ARMS,a)))throw new Error('Invalid arms')
  const save=()=>writeFileSync(flags.output,JSON.stringify({schemaVersion:2,snapshot,build,casesHash:createHash("sha256").update(readFileSync(flags.cases)).digest("hex"),rows,
    note:'Source-reviewed symbol coverage proxy. Failures retained. Repeated paraphrases share group. Experimental = all + depth 3 + three-way verification. No quality promotion from this sample alone.'},null,2)+'\n')
  for(const [i,c] of cases.entries())for(const arm of [...arms.slice(i%arms.length),...arms.slice(0,i%arms.length)]) {
    if(rows.reduce((s,r)=>s+(r.cost??0),0)>=Number(flags['max-cost']??2))throw new Error('Cost limit; partial report saved')
    const extra=arm==='local'?['--jev','off']:['--jev','both','--jev-stages',PROMOTION_ARMS[arm].join(','),'--jev-timeout',String(flags.timeout??8000)]
    if(arm==='experimental')extra.push('--jev-recovery-depth','3','--jev-verify-aspects','true')
    if(arm==='verification')extra.push('--jev-verify-aspects','true')
    if(arm==='deep')extra.push('--jev-recovery-depth','3')
    if(c.aspects)extra.push('--jev-aspects',JSON.stringify(c.aspects))
    let row={name:c.name,group:c.group??c.name,negative:!!c.negative,arm}
    try {
      const {data,ms}=invoke([...(c.args??['context',c.query,'--max-tokens','4000','--limit','10']),...extra,'--diagnostic','--json-detail','full','--max-output-bytes','250000'])
      if((data.index?.snapshotId??data.diagnostic?.index?.snapshotId)!==snapshot)throw new Error('snapshot-changed')
      const required=c.required??(c.expected?[{file:c.expected,symbol:c.symbol}]:[])
      row={...row,status:data.status,ms,...coverageMetrics(required,data.results??[],c.budget?500:5),
        ...factMetrics(c.facts,data.results??[]),timeoutMs:Number(flags.timeout??8000),
        strictCoverage:coverageMetrics(c.strictRequired??required,data.results??[],c.budget?500:5),
        weakEvidence:data.answerSufficiency==='weak-evidence',verdict:data.evidenceAssessment?.verdict,
        cost:data.jev?.cost??0,requests:data.jev?.requests??0,estimatedContextTokens:data.metrics?.estimatedOutputTokens??data.diagnostic?.metrics?.estimatedOutputTokens,
        serializedTokens:data.budget?.usedTokens,
        dependencyCheck:data.jev?.dependencyCheck,requirements:data.evidenceAssessment?.coverage?.map(a=>({id:a.id,witnesses:a.witnesses, strength:a.strength})),
        recovery:data.jev?.recovery,refinement:data.jev?.refinement,packetRepair:data.jev?.packetRepair,contributionCheck:data.jev?.contributionCheck,selection:data.jev?.selection,timeBudget:data.jev?.timeBudget,contextStatus:data.jev?.contextStatus,packetStatus:data.jev?.packetStatus,evaluationStatus:data.jev?.status,models:data.jev?.models,
        symbols:(data.results??[]).map(r=>({file:r.file,symbol:r.symbol??r.metadata?.symbolName,category:r.evidenceCategory??r.jev?.category}))}
    } catch(error) { if(['snapshot-changed','build-changed'].includes(error.message))throw error;row={...row,status:'failed',allRequired:false,error:/^cli-(timeout|exit-)/.test(error.message)?error.message:'invalid-cli-response'} }
    rows.push(row);save();console.log(JSON.stringify({name:c.name,arm,status:row.status,allRequired:row.allRequired,weak:row.weakEvidence}))
  }
  if(invoke(['verify','--strict']).data.snapshotId!==snapshot)throw new Error('Snapshot changed after run')
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main(process.argv.slice(2))
