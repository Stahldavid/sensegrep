// Re-score retained outputs with independently checked symbol labels; makes no model calls.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import path from 'node:path'
import {summarize} from './evaluate-jev-matrix.mjs'
const [directory,casesFile,output]=process.argv.slice(2)
if(!directory||!casesFile||!output) throw new Error('Usage: summarize-jev-run.mjs <matrix-directory> <cases.json> <output.json>')
const cases=JSON.parse(readFileSync(casesFile,'utf8')), arms=['old-local','new-local','old-jev','new-jev'], rows=[]
const matches=(r,g)=>r.file===g.file && (!g.symbol||(r.symbol ?? r.metadata?.symbolName)===g.symbol)
for(let i=0;i<cases.length;i++) {
  const c=cases[i], row={name:c.name,group:c.group??c.name,negative:!!c.negative,required:c.required??(c.expected?[{file:c.expected,symbol:c.symbol}]:[])}
  for(const arm of arms) {
    const run=JSON.parse(readFileSync(path.join(directory,`${i}-${arm}.json`),'utf8'))
    if(run.case.name!==c.name || run.case.query!==c.query) throw new Error('Cases do not match retained outputs')
    const data=run.data, results=data.results??[], selected=c.budget?results:results.slice(0,5)
    const {trace,...jev}=data.jev??{}
    const hits=row.required.map(g=>selected.some(r=>matches(r,g)))
    row[arm]={ms:run.ms,bytes:run.bytes,allRequired:c.negative?data.answerSufficiency==='weak-evidence':row.required.length>0&&hits.every(Boolean),
      hits,verdict:data.evidenceAssessment?.verdict,snapshot:data.diagnostic?.index?.snapshotId??data.index?.snapshotId,
      ...(data.jev?{jev}:{}),symbols:results.map(r=>`${r.file}:${r.symbol??''}`),
      lostAt:row.required.map(g=>({...g,stages:Object.fromEntries(Object.entries(trace??{}).map(([stage,v])=>[stage,v.candidates.some(r=>matches(r,g))]))}))}
  }
  rows.push(row)
}
const summary=summarize(rows,arms)
mkdirSync(path.dirname(path.resolve(output)),{recursive:true})
writeFileSync(output,JSON.stringify({schemaVersion:1,scoring:'Expected symbols in top 5; any returned position for context; weak-evidence for negative queries. Inclusion is not semantic correctness.',rows,summary},null,2)+'\n')
console.log(JSON.stringify(summary))
