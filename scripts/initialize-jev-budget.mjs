import {writeFileSync,mkdirSync} from 'node:fs'
import path from 'node:path'
const output=process.argv[2]
if(!output)throw Error('Ledger path required')
const response=await fetch('https://openrouter.ai/api/v1/models/typesafe/jev-1.13/endpoints')
if(!response.ok)throw Error('Pricing unavailable')
const data=(await response.json()).data
if(!data.endpoints?.length)throw Error('No model endpoints')
for(const e of data.endpoints) {
  if(!Number.isFinite(e.context_length) || e.context_length<=0 || !Number.isFinite(Number(e.pricing.prompt)) || Number(e.pricing.prompt)<=0
    || Number(e.pricing.completion)!==0 || Object.entries(e.pricing).some(([k,v])=>!['prompt','completion','discount'].includes(k) && Number(v)!==0))throw Error('Unsupported pricing structure')
}
const promptUsdPerToken=Math.max(...data.endpoints.map(e=>Number(e.pricing.prompt)))
const contextLength=Math.max(...data.endpoints.map(e=>e.context_length))
// Reserve twice the advertised maximum full-context input charge per request.
// Actual usage only releases unused funds; unknown/failed attempts retain it all.
const ceilingPerRequestUsd=Math.ceil(contextLength*promptUsdPerToken*2*1e12)/1e12
mkdirSync(path.dirname(path.resolve(output)),{recursive:true})
writeFileSync(output,JSON.stringify({capUsd:.5,promptUsdPerToken,contextLength,ceilingPerRequestUsd,
  chargedUpperBoundUsd:0,blocked:false,checkedAt:new Date().toISOString(),pricing:data.endpoints,requests:[]},null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify({capUsd:.5,ceilingPerRequestUsd,promptUsdPerToken,output}))
