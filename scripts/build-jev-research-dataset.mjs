// Explicit source-reviewed labels, never judge-generated ground truth. Source output stays local.
import fs from 'node:fs/promises'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {TreeSitterChunking} from '../packages/core/dist/semantic/chunking-treesitter.js'
const flags={};for(let i=2;i<process.argv.length;i+=2)flags[process.argv[i].replace(/^--/,'')]=process.argv[i+1]
for(const k of ['root','output'])if(!flags[k])throw new Error(`Required --${k}`)
const manifest=JSON.parse(await fs.readFile(flags.manifest??'scripts/fixtures/jev-research-reviewed.json','utf8'))
const rows=[],cache=new Map(),splits=new Map()
const cli=args=>{
  const p=spawnSync(process.execPath,['packages/cli/dist/main.js',...args,'--root',flags.root,'--json','--log-format','none'],{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:8*1024*1024})
  if(p.status!==0)throw new Error('Dataset retrieval failed')
  return JSON.parse(p.stdout)
}
const snapshot=cli(['verify','--strict']).snapshotId
for(const c of manifest.cases) {
  if(splits.has(c.group)&&splits.get(c.group)!==c.split)throw new Error('Group leakage')
  splits.set(c.group,c.split)
  if(!cache.has(c.file)) {
    const source=await fs.readFile(path.join(flags.root,c.file),'utf8')
    cache.set(c.file,{hash:createHash('sha256').update(source).digest('hex'),chunks:await TreeSitterChunking.chunk(source,c.file)})
  }
  const {hash,chunks}=cache.get(c.file)
  for(const query of c.queries) {
    const data=cli(['search',query,'--jev','off','--limit','80','--max-per-file','0','--json-detail','full','--max-output-bytes','1000000'])
    for(const symbol of [...Object.keys(c.positive),...c.negative]) {
      const chunk=chunks.filter(r=>r.symbolName===symbol).sort((a,b)=>a.content.length-b.content.length)[0]
      if(!chunk)throw new Error(`Reviewed symbol missing: ${c.file}:${symbol}`)
      const local=data.results?.find(r=>r.file===c.file&&(r.symbolName??r.metadata?.symbolName)===symbol)
      const terms=query.toLowerCase().match(/[\p{L}\p{N}_]+/gu)??[],source=chunk.content.toLowerCase()
      rows.push({group:`${manifest.repository??'curaai'}:${c.group}`,repository:manifest.repository??'curaai',queryFamily:c.group,split:c.split,query,
        label:Object.hasOwn(c.positive,symbol)?1:0,evidenceLabel:c.positive[symbol]??'irrelevant',labelSource:manifest.labelSource,
        sourceHash:hash,snapshot,candidateOrigin:'explicit-reviewed-pair-not-retrieval-recall',
        candidate:{file:c.file,startLine:chunk.startLine,endLine:chunk.endLine,content:chunk.content,semanticScore:local?.score??0,
          metadata:{symbolName:symbol,symbolType:chunk.symbolType}},
        features:{localScore:Math.min(1,Math.max(0,local?.score??0)),lexicalOverlap:terms.filter(t=>source.includes(t)).length/Math.max(1,terms.length),
          sourceLines:chunk.endLine-chunk.startLine+1,sourceCharacters:chunk.content.length,isFunction:chunk.symbolType==='function'?1:0}})
    }
  }
}
if(cli(['verify','--strict']).snapshotId!==snapshot)throw new Error('Snapshot changed')
await fs.mkdir(path.dirname(path.resolve(flags.output)),{recursive:true})
await fs.writeFile(flags.output,JSON.stringify(rows,null,2)+'\n',{mode:0o600})
console.log(JSON.stringify({rows:rows.length,groups:[...splits],snapshot,labelSource:manifest.labelSource}))
