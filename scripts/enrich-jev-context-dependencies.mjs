// Enrich an existing frozen pool with same-file AST call edges, never new candidates.
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {TreeSitterChunking} from '../packages/core/dist/semantic/chunking-treesitter.js'
const [root,input,output]=process.argv.slice(2)
if(!root||!input||!output)throw new Error('Usage: root input output')
if(await fs.access(output).then(()=>true,()=>false))throw new Error('Refuse overwrite')
const raw=await fs.readFile(input),data=JSON.parse(raw),calls=new Map(),sourceHashes={}
const verify=()=>{
  const p=spawnSync(process.execPath,['packages/cli/dist/main.js','verify','--strict','--root',root,'--json','--log-format','none'],{encoding:'utf8',windowsHide:true,timeout:90000})
  if(p.status!==0||JSON.parse(p.stdout).snapshotId!==data.snapshot)throw new Error('Frozen source/index changed')
}
verify()
for(const episode of data.episodes)for(const row of episode.candidates){
  row.dependencies=[]
  const c=row.candidate
  if(row.tokens>512||!row.complete||!['function','method'].includes(c.metadata.symbolType)||! /\.[cm]?[jt]sx?$/.test(c.file))continue
  if(!calls.has(c.file)){
    const absolute=path.resolve(root,c.file),relative=path.relative(root,absolute)
    if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Outside frozen root')
    if((await fs.stat(absolute)).size>512000){calls.set(c.file,[]);continue}
    const source=await fs.readFile(absolute,'utf8')
    sourceHashes[c.file]=createHash('sha256').update(source).digest('hex')
    calls.set(c.file,await TreeSitterChunking.graphCalls(source,c.file))
  }
  for(const call of calls.get(c.file)){
    if(call.module||call.line<c.startLine||call.line>c.endLine||! /^[\w$]+$/.test(call.target))continue
    const matches=episode.candidates.filter(r=>r.id!==row.id&&r.candidate.file===c.file&&r.candidate.metadata.symbolName===call.target
      &&['function','method'].includes(r.candidate.metadata.symbolType))
    if(matches.length===1&&!row.dependencies.includes(matches[0].id))row.dependencies.push(matches[0].id)
  }
}
verify()
data.dependencyContract={version:'same-file-ast-small-callees-v1',sourceDatasetSha256:createHash('sha256').update(raw).digest('hex'),sourceHashes}
await fs.writeFile(output,JSON.stringify(data,null,2)+'\n',{mode:0o600})
for(const split of ['dev','test'])await fs.writeFile(output.replace(/\.json$/,'')+`-${split}.json`,JSON.stringify({...data,episodes:data.episodes.filter(e=>e.split===split)},null,2)+'\n',{mode:0o600})
console.log(JSON.stringify({episodes:data.episodes.length,contract:data.dependencyContract.version}))
