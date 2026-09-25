// Export source-free decisions for HUMAN labelling. Absence from a gold list is not a negative label.
import {readFileSync,writeFileSync,readdirSync} from 'node:fs'
import path from 'node:path'
const [directory,output]=process.argv.slice(2)
if(!directory||!output) throw new Error('Usage: node scripts/export-jev-calibration.mjs <matrix-directory> <output.json>')
const samples=[]
for(const filename of readdirSync(directory).filter(n=>/^\d+-new-jev.json$/.test(n))) {
  const run=JSON.parse(readFileSync(path.join(directory,filename),'utf8'))
  for(const c of run.data.jev?.trace?.evaluated?.candidates ?? []) samples.push({
    group:run.case.group ?? run.case.name, query:run.case.query, split:null,label:null,
    evidence:{file:c.file,symbol:c.symbol,key:c.key},
    judging:{contractHash:run.data.jev?.contractHash,models:run.data.jev?.models,panel:run.data.jev?.panel,batchSize:run.data.jev?.batchSize},
    features:{localScore:c.localScore ?? 0, modelScore:c.modelScore ?? 0, confidence:c.confidence ?? 0, contradiction:c.contradiction ?? 0,
      scoreMean:c.relevance?.score ?? 0,
      scoreAvailable:Number(!!c.relevance),
      usefulMass:(c.relevance?.probabilities?.['2']??0)+(c.relevance?.probabilities?.['3']??0),
      directMass:c.relevance?.probabilities?.['3']??0,
      scoreSpread:Math.sqrt(Object.entries(c.relevance?.probabilities??{}).reduce((s,[k,p])=>s+p*(Number(k)-(c.relevance?.score??0))**2,0)),
      maxAspect:Math.max(0,...Object.values(c.aspects??{})), minAspect:Object.keys(c.aspects??{}).length?Math.min(...Object.values(c.aspects)):0,
      asksValue:Number(/\b(value|valor|constant|constante|setting)\b/i.test(run.case.query)),
      asksCondition:Number(/\b(when|if|unless|except|exception|quando|caso|excecao|apesar)\b/i.test(run.case.query)),
      queryWords:run.case.query.split(/\s+/).length, ...c.dimensions},
  })
}
writeFileSync(output,JSON.stringify(samples,null,2)+'\n')
console.log(JSON.stringify({rows:samples.length,status:'requires-independent-labels-and-disjoint-group-splits'}))
