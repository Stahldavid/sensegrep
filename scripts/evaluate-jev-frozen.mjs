// Capture local candidates once, then vary only the judge. Source fixtures stay local.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { evaluateWithJev, rankWithJev, jevResultKey } from '../packages/core/dist/tool/jev.js'

const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex')
export function perturb(candidates, variant) {
  if (variant === 'reverse') return [...candidates].reverse()
  if (variant === 'distractor') return [...candidates, {file:'__irrelevant_fixture.ts',startLine:1,endLine:1,
    content:'export function unrelatedLayoutColor() { return "purple" }', semanticScore:0,metadata:{symbolName:'unrelatedLayoutColor'}}]
  return [...candidates]
}
export function quality(c, rows) {
  const matches = (r, e) => r.file === e.file && (!e.symbol || r.metadata.symbolName === e.symbol)
  const required = c.required ?? (c.expected ? [{file:c.expected,symbol:c.symbol}] : [])
  const ranks = required.map(e => rows.findIndex(r => matches(r,e)) + 1)
  return {ranks, allRequired:required.length ? ranks.every(r=>r>0 && r<=5) : null,
    poolRecall:required.length ? ranks.filter(r=>r>0).length/required.length : null,
    maxEvidence:Math.max(0,...rows.slice(0,5).map(r=>r.jev?.evidence ?? 0))}
}
export async function main(argv) {
  const mode=argv[0], flags={}
  for(let i=1;i<argv.length;i++) { const key=argv[i].replace(/^--/,''); flags[key]=['live','resume'].includes(key)?true:argv[++i] }
  if(!flags.output) throw new Error('Required --output')
  mkdirSync(path.dirname(path.resolve(flags.output)),{recursive:true})
  if(mode==='capture') {
    if(!flags.root||!flags.cases) throw new Error('capture --root ROOT --cases CASES --output LOCAL.json')
    const cases=JSON.parse(readFileSync(flags.cases,'utf8')).filter(c=>!c.budget).slice(0,Number(flags.limit??100))
    const invoke=args=>{
      const p=spawnSync(process.execPath,['packages/cli/dist/main.js',...args,'--root',flags.root,'--json','--log-format','none'],{encoding:'utf8',windowsHide:true,timeout:90000,maxBuffer:32*1024*1024})
      if(p.status!==0) throw new Error('Local CLI failed')
      return JSON.parse(p.stdout)
    }
    const snapshot=invoke(['verify','--strict']).snapshotId
    if(!snapshot) throw new Error('Missing index snapshot')
    const samples=cases.map(c=>{
      const data=invoke(['search',c.query,'--limit',String(flags.candidates??20),'--max-per-file','0','--no-shake','--jev','off','--json-detail','full','--max-output-bytes','1000000'])
      if(data.status!=='complete'||!data.results?.length||data.budget?.truncated) throw new Error(`Incomplete capture ${c.name}`)
      return {...c,candidates:data.results.map(r=>({file:r.file,startLine:r.startLine,endLine:r.endLine,content:r.content,
        contentTruncated:!!r.contentTruncated,semanticScore:Math.min(1,r.score??.5),metadata:{...r.metadata,symbolName:r.symbolName,symbolType:r.symbolType}}))}
    })
    if(invoke(['verify','--strict']).snapshotId!==snapshot) throw new Error('Index changed during capture')
    writeFileSync(flags.output,JSON.stringify({schemaVersion:1,snapshot,samples},null,2)+'\n',{mode:0o600})
    console.log(JSON.stringify({cases:samples.length,snapshot,source:'local-only-fixture'}));return
  }
  if(mode!=='run'||!flags.input||!flags.live) throw new Error('run --live --input LOCAL.json --output REPORT.json')
  const input=JSON.parse(readFileSync(flags.input,'utf8')), previous=flags.resume?JSON.parse(readFileSync(flags.output,'utf8')):null
  if(previous && previous.fixtureHash!==hash(input)) throw new Error('Cannot resume a different frozen fixture')
  const rows=previous?.rows??[]
  const settings=['noul','score','composite'].flatMap(panel=>[1,5,10].flatMap(batchSize=>['normal','reverse','distractor'].map(variant=>({panel,batchSize,variant}))))
  const save=()=>writeFileSync(flags.output,JSON.stringify({schemaVersion:1,fixtureHash:hash(input),snapshot:input.snapshot,
    note:'Frozen returned candidate pools; symbol coverage proxy, not agent correctness. No source in this report.',rows},null,2)+'\n')
  for(const [caseIndex,c] of input.samples.entries()) {
    const canonicalKeys=c.candidates.map(jevResultKey)
    // Rotate arm order to avoid always measuring one panel first.
    const arms=[...settings.slice(caseIndex%settings.length),...settings.slice(0,caseIndex%settings.length)]
    for(const arm of arms) {
      if(rows.some(r=>r.name===c.name && r.panel===arm.panel && r.batchSize===arm.batchSize && r.variant===arm.variant)) continue
      const candidates=perturb(c.candidates,arm.variant),start=performance.now()
      const result=await evaluateWithJev(c.query,candidates,{mode:'both',panel:arm.panel,batchSize:arm.batchSize,candidates:80,timeoutMs:30000},{cache:false})
      const canonical=c.candidates.map(r=>({...r,jev:result.scores.get(jevResultKey(r))}))
      const rankings=result.diagnostics.status==='complete'?Object.fromEntries(['score','useful','noul','rrf','confidence-baseline'].map(strategy=>[
        strategy,quality(c,rankWithJev(c.candidates,result.scores,strategy))])):{}
      rows.push({name:c.name,group:c.group??c.name,negative:!!c.negative,...arm,ms:Math.round(performance.now()-start),
        baseline:quality(c,c.candidates),rankings,diagnostics:result.diagnostics,
        scores:canonical.map((r,i)=>({key:canonicalKeys[i],evidence:r.jev?.evidence,relevance:r.jev?.relevance,dimensions:r.jev?.dimensions}))})
      save()
      console.log(JSON.stringify({name:c.name,...arm,status:result.diagnostics.status,top5:rankings.score?.allRequired,cost:result.diagnostics.cost}))
      // Failed arms remain failures in the denominator; no silent retry or success imputation.
      if(rows.reduce((s,r)=>s+r.diagnostics.cost,0)>Number(flags['max-cost']??2)) throw new Error('Run cost budget reached; partial report saved')
    }
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) await main(process.argv.slice(2))
