// Four-arm, paired evaluation on one frozen index. No installs or index writes.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

export function pairedInterval(rows, before, after, metric, iterations = 2000) {
  const groups = [...new Set(rows.map(r => r.group ?? r.name))]
  if (!groups.length) return null
  let seed = 1729
  const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
  const sample = []
  for (let n = 0; n < iterations; n++) {
    const picked = Array.from({ length: groups.length }, () => groups[Math.floor(rand() * groups.length)])
    const deltas = picked.flatMap(g => rows.filter(r => (r.group ?? r.name) === g).map(r => metric(r[after]) - metric(r[before])))
    sample.push(deltas.reduce((a,b) => a+b, 0) / deltas.length)
  }
  sample.sort((a,b) => a-b)
  return { lower: sample[Math.floor(iterations*.025)], upper: sample[Math.floor(iterations*.975)], groups: groups.length, method: 'paired-group-bootstrap', seed:1729 }
}
export function summarize(rows, arms) {
  const quality = r => r.allRequired ? 1 : 0
  return { arms: Object.fromEntries(arms.map(a => [a, {
    cases: rows.length, allRequired: rows.filter(r => r[a].allRequired).length,
    falseSufficiency: rows.filter(r => r.negative && r[a].verdict === 'direct-evidence').length,
    medianMs: rows.map(r => r[a].ms).sort((a,b)=>a-b)[Math.floor(rows.length/2)],
    p95Ms: rows.map(r => r[a].ms).sort((a,b)=>a-b)[Math.max(0,Math.ceil(rows.length*.95)-1)],
    cost: rows.reduce((s,r)=>s+(r[a].jev?.cost ?? 0),0),
    requests: rows.reduce((s,r)=>s+(r[a].jev?.requests ?? 0),0),
    evaluated: rows.reduce((s,r)=>s+(r[a].jev?.evaluated ?? 0),0),
  } ])),
  intervals: { newJevVersusNewLocal: pairedInterval(rows,'new-local','new-jev',quality), newJevVersusOldJev: pairedInterval(rows,'old-jev','new-jev',quality) },
  note: 'Symbol coverage is a retrieval proxy, not independently reviewed answer correctness or agent token savings.' }
}
export async function main(argv) {
  const flags = Object.fromEntries(Array.from({length:argv.length/2},(_,i)=>[argv[i*2].replace(/^--/,''),argv[i*2+1]]))
  for (const key of ['root','baseline','cases','output']) if (!flags[key]) throw new Error(`Missing --${key}`)
  const cases = JSON.parse(readFileSync(flags.cases,'utf8'))
  const candidate = path.resolve(flags.candidate ?? fileURLToPath(new URL('../packages/cli/dist/main.js',import.meta.url)))
  const output = path.resolve(flags.output); mkdirSync(output,{recursive:true})
  const invoke = (cli,args) => {
    const started=performance.now()
    const p=spawnSync(process.execPath,[cli,...args,'--root',path.resolve(flags.root),'--json','--log-format','none'],{
      encoding:'utf8',timeout:90000,maxBuffer:32*1024*1024,env:{...process.env,SENSEGREP_JEV_CACHE:'false'},windowsHide:true})
    if(p.status!==0) throw new Error(`CLI exited ${p.status}: ${(p.stderr ?? '').slice(-1000)}`)
    return {data:JSON.parse(p.stdout),ms:Math.round(performance.now()-started),bytes:Buffer.byteLength(p.stdout)}
  }
  const initial=invoke(candidate,['verify','--strict']).data
  const arms=['old-local','new-local','old-jev','new-jev'], rows=[]
  for(let i=0;i<cases.length;i++) {
    const c=cases[i], row={name:c.name,group:c.group ?? c.name,negative:!!c.negative}
    const order=[...arms.slice(i%4),...arms.slice(0,i%4)]
    for(const arm of order) {
      const args=c.args ?? ['search',c.query,'--limit','10','--diagnostic']
      const old=arm.startsWith('old'), jev=arm.endsWith('-jev')
      const extra=jev?['--jev','both','--jev-candidates',String(old?Math.min(40,Number(flags.candidates ?? 20)):Number(flags.candidates ?? 20))]:['--jev','off']
      if(!old && jev && c.aspects) extra.push('--jev-aspects',JSON.stringify(c.aspects))
      if(!old && jev && flags.ranking) extra.push('--jev-ranking',flags.ranking)
      const run=invoke(old?path.resolve(flags.baseline):candidate,[...args,...extra])
      const data=run.data, results=data.results ?? [], snapshot=data.diagnostic?.index?.snapshotId ?? data.index?.snapshotId
      if(snapshot!==initial.snapshotId) throw new Error(`Index changed or diagnostic snapshot missing: ${c.name}`)
      const required=c.required ?? (c.expected?[{file:c.expected,symbol:c.symbol}]:[])
      const matches=(rs,expected)=>rs.some(r=>r.file===expected.file && (!expected.symbol || (r.symbol ?? r.metadata?.symbolName)===expected.symbol))
      const hits=required.map(r=>matches(c.budget?results:results.slice(0,5),r))
      const allRequired=c.negative ? data.answerSufficiency==='weak-evidence' : required.length>0 && hits.every(Boolean)
      row[arm]={ms:run.ms,bytes:run.bytes,allRequired,hits,verdict:data.evidenceAssessment?.verdict,snapshot,jev:data.jev,
        lostAt: required.map(expected=>({ ...expected,stages:Object.fromEntries(Object.entries(data.jev?.trace ?? {}).map(([stage,v])=>[stage,matches(v.candidates,expected)])) })),
        symbols:results.map(r=>`${r.file}:${r.symbol ?? ''}`)}
      writeFileSync(path.join(output,`${i}-${arm}.json`),JSON.stringify({case:c,...run},null,2))
    }
    rows.push(row); writeFileSync(path.join(output,'matrix.json'),JSON.stringify(rows,null,2))
    console.log(JSON.stringify({name:c.name,arms:Object.fromEntries(arms.map(a=>[a,row[a].allRequired]))}))
  }
  if(invoke(candidate,['verify','--strict']).data.snapshotId!==initial.snapshotId) throw new Error('Final snapshot changed')
  const totals=summarize(rows,arms)
  writeFileSync(path.join(output,'totals.json'),JSON.stringify({snapshot:initial.snapshotId,candidates:Number(flags.candidates ?? 20),...totals},null,2))
  console.log(JSON.stringify(totals))
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) await main(process.argv.slice(2))
