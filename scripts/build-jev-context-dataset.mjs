// Freeze real retrieved pools; absent gold is never injected. Source stays local.
import fs from 'node:fs/promises'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {TreeSitterChunking} from '../packages/core/dist/semantic/chunking-treesitter.js'
import {evaluateWithJev} from '../packages/core/dist/tool/jev.js'
import {evidenceAspects,selectEvidenceCoverage,evidenceKey} from '../packages/core/dist/tool/jev-coverage.js'
import {labelEvidence} from '../packages/core/dist/tool/jev-routing.js'
import {flexibleDiversity} from '../packages/core/dist/tool/search-quality.js'
import {selectWithinTokenBudget,estimateResultTokens} from '../packages/core/dist/tool/sensegrep-pipeline.js'
const flags={};for(let i=2;i<process.argv.length;i+=2)flags[process.argv[i].slice(2)]=process.argv[i+1]
for(const k of ['root','manifest','output'])if(!flags[k])throw new Error(`Missing --${k}`)
const manifestBytes=await fs.readFile(flags.manifest),manifest=JSON.parse(manifestBytes)
const cli=args=>{const p=spawnSync(process.execPath,['packages/cli/dist/main.js',...args,'--root',flags.root,'--json','--log-format','none'],{encoding:'utf8',windowsHide:true,timeout:90000,maxBuffer:8e6});if(p.status!==0)throw new Error('CLI failed');return JSON.parse(p.stdout)}
const snapshot=cli(['verify','--strict']).snapshotId
if(!snapshot)throw new Error('Missing snapshot')
const manifestSha256=createHash('sha256').update(manifestBytes).digest('hex')
const binarySha256=createHash('sha256').update(await fs.readFile('packages/cli/dist/main.js')).update(await fs.readFile('packages/core/dist/tool/sensegrep-pipeline.js')).digest('hex')
const checkpointPath=flags.output+'.checkpoint.json'
await fs.mkdir(path.dirname(path.resolve(flags.output)),{recursive:true})
if(await fs.access(flags.output).then(()=>true,()=>false))throw new Error('Refuse to overwrite frozen dataset')
const saved=await fs.readFile(checkpointPath,'utf8').then(JSON.parse,()=>null)
if(saved&&(saved.snapshot!==snapshot||saved.manifestSha256!==manifestSha256||saved.binarySha256!==binarySha256))throw new Error('Checkpoint input changed')
const episodes=saved?.episodes??[],sourceCache=new Map();let cost=saved?.cost??0
const checkpoint=()=>fs.writeFile(checkpointPath,JSON.stringify({snapshot,manifestSha256,binarySha256,episodes,cost}),{mode:0o600})
const symbolKey=r=>`${r.file}:${r.symbol??r.metadata?.symbolName??''}`
for(const c of manifest.cases){
  if(episodes.some(e=>e.id===c.id))continue
  for(const required of c.required){
    if(!sourceCache.has(required.file)){
      const source=await fs.readFile(path.join(flags.root,required.file),'utf8')
      sourceCache.set(required.file,{hash:createHash('sha256').update(source).digest('hex'),chunks:await TreeSitterChunking.chunk(source,required.file)})
    }
    if(!sourceCache.get(required.file).chunks.some(r=>r.symbolName===required.symbol))throw new Error('Reviewed gold symbol missing')
  }
  if(cost>=Number(flags['max-cost']??2))throw new Error('Dataset budget exceeded')
  const retrievalStarted=performance.now()
  const data=cli(['search',c.query,'--jev','off','--limit','20','--max-per-file','0','--json-detail','full','--max-output-bytes','2000000'])
  const retrievalWallMs=performance.now()-retrievalStarted
  const working=data.results.map(r=>({file:r.file,startLine:r.startLine,endLine:r.endLine,content:r.content,
    contentTruncated:r.contentTruncated,semanticScore:r.score,rerankScore:r.score,metadata:r.metadata,whyMatched:r.whyMatched}))
  const aspects=evidenceAspects(c.query)
  let judged
  for(let attempt=0;attempt<2;attempt++){
    if(cost>=Number(flags['max-cost']??2))throw new Error('Dataset budget exceeded')
    judged=await evaluateWithJev(c.query,working,{mode:'both',aspects,timeoutMs:Number(flags['jev-timeout']??30000),batchSize:5},{cache:true})
    cost+=judged.diagnostics.cost
    if(judged.diagnostics.status==='complete')break
    await checkpoint()
  }
  if(judged.diagnostics.status!=='complete'){await checkpoint();throw new Error(`Incomplete baseline Jev evaluation (${judged.diagnostics.status}: ${judged.diagnostics.reason}); completed episodes checkpointed`)}
  const localDiverse=flexibleDiversity(working,c.query,2)
  const local=selectWithinTokenBudget(localDiverse,c.budget??4000,c.query,5).results
  const diverse=flexibleDiversity(labelEvidence(judged.results,judged.truncated),c.query,2)
  const coverage=selectEvidenceCoverage(diverse,aspects,c.budget??4000,5,estimateResultTokens)
  const current=coverage.results.length?coverage.results:local
  const required=new Map(c.required.map(r=>[symbolKey(r),r.role??'rule']))
  const negatives=new Set((c.negative??[]).map(symbolKey))
  const terms=c.query.toLowerCase().match(/[\p{L}\p{N}_]+/gu)??[]
  episodes.push({id:c.id,group:c.group,split:c.split,query:c.query,budget:c.budget??4000,limit:5,retrievalWallMs,
    required:c.required.map(r=>({key:symbolKey(r),role:r.role??'rule'})),
    sourceHashes:Object.fromEntries(c.required.map(r=>[r.file,sourceCache.get(r.file).hash])),
    candidates:working.map((r,i)=>{
      const key=symbolKey(r),score=judged.scores.get(evidenceKey(r)),source=r.content.toLowerCase()
      return {id:evidenceKey(r),key,label:required.has(key)?1:negatives.has(key)?0:null,
        candidate:r,tokens:estimateResultTokens(r),complete:!r.contentTruncated,
        features:{localScore:r.semanticScore,localRank:1/(i+1),lexicalOverlap:terms.filter(t=>source.includes(t)).length/Math.max(1,terms.length),
          logTokens:Math.log1p(estimateResultTokens(r)),isFunction:Number(r.metadata.symbolType==='function'),
          isTest:Number(r.metadata.fileRole==='test'),modelInputComplete:Number(!r.contentTruncated&&r.content.length<=24000)},
        jev:{evidence:score?.evidence,category:diverse.find(d=>evidenceKey(d)===evidenceKey(r))?.jev?.category}}
    }),baseline:{local:local.map(r=>({id:evidenceKey(r),key:symbolKey(r),complete:!r.contentTruncated,tokens:estimateResultTokens(r)})),
      current:current.map(r=>({id:evidenceKey(r),key:symbolKey(r),complete:!r.contentTruncated,tokens:estimateResultTokens(r)}))},
    trace:{retrieved:working.map(symbolKey),evaluated:judged.results.filter(r=>judged.scores.has(evidenceKey(r))).map(symbolKey),diversified:diverse.map(symbolKey)},
    diagnostics:judged.diagnostics})
  await checkpoint()
  console.log(JSON.stringify({id:c.id,split:c.split,...(c.split==='dev'?{candidates:working.length,reviewed:episodes.at(-1).candidates.filter(r=>r.label!==null).length}:{frozen:true})}))
}
if(cli(['verify','--strict']).snapshotId!==snapshot)throw new Error('Snapshot changed')
await fs.mkdir(path.dirname(path.resolve(flags.output)),{recursive:true})
await fs.writeFile(flags.output,JSON.stringify({schemaVersion:1,snapshot,manifestSha256,binarySha256,
  labelSource:manifest.labelSource,baselineContract:'frozen-pool local diversity+budget vs current Jev coverage; no expansion or adaptive retry',episodes,cost},null,2)+'\n',{mode:0o600})
const frozen=JSON.parse(await fs.readFile(flags.output,'utf8'))
for(const split of ['dev','test']){
  const filename=flags.output.replace(/\.json$/,'')+`-${split}.json`
  await fs.writeFile(filename,JSON.stringify({...frozen,episodes:episodes.filter(e=>e.split===split)},null,2)+'\n',{mode:0o600})
}
