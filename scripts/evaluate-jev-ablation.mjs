// Focused cost/quality sweep; uses an existing frozen index, never indexes or installs.
import {spawnSync} from 'node:child_process'
import {readFileSync,writeFileSync} from 'node:fs'
import path from 'node:path'
const [root,casesFile,output]=process.argv.slice(2)
if(!root||!casesFile||!output) throw new Error('Usage: node scripts/evaluate-jev-ablation.mjs <frozen-root> <cases.json> <output.json>')
const cases=JSON.parse(readFileSync(casesFile,'utf8')), rows=[]
for(const c of cases) for(const cap of [20,40,80]) for(const ranking of ['score','rrf']) {
  const start=performance.now()
  const p=spawnSync(process.execPath,['packages/cli/dist/main.js','search',c.query,'--root',root,'--limit','5','--jev','both','--jev-candidates',String(cap),'--jev-ranking',ranking,'--diagnostic','--json','--log-format','none'],{
    encoding:'utf8',timeout:60000,maxBuffer:32*1024*1024,windowsHide:true,env:{...process.env,SENSEGREP_JEV_CACHE:'false'}})
  if(p.status!==0) throw new Error(`CLI failed: ${p.status}`)
  const data=JSON.parse(p.stdout), results=data.results ?? []
  const row={name:c.name,cap,ranking,ms:Math.round(performance.now()-start),snapshot:data.diagnostic?.index?.snapshotId,
    symbolRank:results.findIndex(r=>r.file===c.expected && (!c.symbol||r.symbol===c.symbol))+1,
    cost:data.jev?.cost,requests:data.jev?.requests,model:data.jev?.models,status:data.jev?.status,weakEvidence:data.answerSufficiency==='weak-evidence'}
  if(!row.snapshot||rows.length && rows[0].snapshot!==row.snapshot) throw new Error('Missing or changed snapshot')
  rows.push(row);writeFileSync(path.resolve(output),JSON.stringify(rows,null,2)+'\n');console.log(JSON.stringify(row))
}
