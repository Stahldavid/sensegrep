import {readFileSync,writeFileSync} from 'node:fs'
import path from 'node:path'

const directory=process.argv[2]
if(!directory)throw new Error('Usage: node scripts/summarize-jev-promotion.mjs <report-directory>')
const load=name=>JSON.parse(readFileSync(path.join(directory,`${name}.json`),'utf8'))
const stages=['curaai','sensegrep'].flatMap(repository=>load(repository).rows.map(r=>({...r,repository})))
const agents=load('agent').rows
if(stages.length!==100||agents.length!==36)throw new Error('Incomplete promotion experiment')
const sum=(rows,key)=>rows.reduce((s,r)=>s+(r[key]??0),0)
const groups=(rows,key,measure)=>Object.fromEntries([...new Set(rows.map(r=>r[key]))].map(k=>[k,measure(rows.filter(r=>r[key]===k))]))
const result={
  decision:'Keep optional: aggregate symbol coverage does not improve; deep recovery regresses.',
  stages:groups(stages,'arm',rows=>({runs:rows.length,positive:rows.filter(r=>!r.negative).length,
    allRequired:rows.filter(r=>!r.negative&&r.allRequired).length,negative:rows.filter(r=>r.negative).length,
    weakNegative:rows.filter(r=>r.negative&&r.weakEvidence).length,failed:rows.filter(r=>r.status==='failed').length,
    meanMs:sum(rows,'ms')/rows.length,cost:sum(rows,'cost')})),
  agents:groups(agents,'mode',rows=>({runs:rows.length,passed:rows.filter(r=>r.passed).length,
    inputTokens:sum(rows,'inputTokens'),outputTokens:sum(rows,'outputTokens'),searches:sum(rows,'searches'),
    reads:sum(rows,'reads'),meanMs:sum(rows,'totalMs')/rows.length,cost:sum(rows,'cost'),jevCost:sum(rows,'jevCost')})),
  external:load('learned-external'),
  limitations:['Paraphrases and repeats are not independent samples.','Source-reviewed answer keys are agent-authored.',
    'Agent runs use normal caching; stage runs disable Jev cache.','Frozen learned model is compared to an uncalibrated raw score, not a fitted baseline.',
    'No production model or coding-task evaluation; cost with Luna does not predict production economics.'],
}
writeFileSync(path.join(directory,'summary.json'),JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify(result,null,2))
