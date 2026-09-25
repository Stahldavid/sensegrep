import {writeFileSync,mkdirSync} from 'node:fs'
import {assessJevQuery,assessJevPacket} from '../packages/core/dist/tool/jev.js'
import {evidenceAspects} from '../packages/core/dist/tool/jev-coverage.js'
import {witnessCases} from './fixtures/jev-witness-cases.mjs'
const dir='docs/evaluations/jev-v10-contract-2026-09-25';mkdirSync(dir,{recursive:true})
const interpretations=new Map(),rows=[]
for(const c of witnessCases()) {
 if(!interpretations.has(c.query)) interpretations.set(c.query,await assessJevQuery(c.query,{timeoutMs:5000}))
 const interpretation=interpretations.get(c.query),aspects=evidenceAspects(c.query)
 if(interpretation.openQuestion) for(const a of aspects) a.queryMode='open-question'
 const result=await assessJevPacket(c.query,c.rows,{mode:'evidence',aspects,timeoutMs:6000,inspection:{status:'complete',pending:[]}})
 rows.push({id:c.id,query:c.query,expectedComplete:c.expectedComplete,accepted:result.verdict==='direct-evidence',verdict:result.verdict,interpretation:interpretation.assertedPremise,assessment:result})
 writeFileSync(dir+'/results.json',JSON.stringify(rows,null,2)+'\n')
 console.log(JSON.stringify({id:c.id,expected:c.expectedComplete,verdict:result.verdict}))
}
