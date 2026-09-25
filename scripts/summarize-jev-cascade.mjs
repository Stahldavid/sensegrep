import {readFileSync,writeFileSync} from 'node:fs'
import path from 'node:path'
const dir=process.argv[2]
if(!dir)throw new Error('Pass evaluation directory')
const read=name=>JSON.parse(readFileSync(path.join(dir,name+'.json'),'utf8'))
const rows=['sensegrep','curaai'].flatMap(repo=>read(repo+'-cascade').rows.map(r=>({...r,repository:repo})))
const agent=read('agent-cascade').rows
if(rows.length!==50||agent.length!==6)throw new Error('Incomplete experiment')
const sum=(r,k)=>r.reduce((s,x)=>s+(x[k]??0),0)
const stage=arm=>{
  const r=rows.filter(x=>x.arm===arm)
  return {queries:r.length,positive:r.filter(x=>!x.negative).length,allRequired:r.filter(x=>x.allRequired).length,
    weakNegatives:r.filter(x=>x.negative&&x.weakEvidence).length,failures:r.filter(x=>x.status==='failed').length,
    meanMs:sum(r,'ms')/r.length,refinements:r.filter(x=>x.refinement).map(x=>({name:x.name,...x.refinement})),
    misses:r.filter(x=>!x.negative&&!x.allRequired).map(x=>x.name)}
}
const output={stages:{local:stage('local'),jev:stage('all')},agents:Object.fromEntries(['off','both'].map(mode=>{
  const r=agent.filter(x=>x.mode===mode)
  return [mode,{runs:r.length,passed:r.filter(x=>x.passed).length,inputTokens:sum(r,'inputTokens'),meanMs:sum(r,'totalMs')/r.length}]
})),limitations:['Known regression/development cases, not untouched holdout.','Three agent tasks, one repetition; no significance claim.',
  'Concurrent experiments affect wall times.','Configured default does not enable experimental learned weights or deep recovery.']}
writeFileSync(path.join(dir,'cascade-summary.json'),JSON.stringify(output,null,2)+'\n')
console.log(JSON.stringify(output,null,2))
