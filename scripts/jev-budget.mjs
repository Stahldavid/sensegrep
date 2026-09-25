import {readFileSync,writeFileSync,openSync,closeSync,unlinkSync,renameSync} from 'node:fs'
import {randomUUID,createHash} from 'node:crypto'

// Synchronous lock covers all workers/processes sharing this ledger. A stale lock
// fails closed; never release reservations after an uncertain network outcome.
export function transaction(file,fn) {
  const lock=file+'.lock',fd=openSync(lock,'wx')
  try {
    const data=JSON.parse(readFileSync(file,'utf8')),result=fn(data)
    const temp=file+'.'+randomUUID()+'.tmp'
    writeFileSync(temp,JSON.stringify(data)+'\n');renameSync(temp,file)
    return result
  } finally {closeSync(fd);unlinkSync(lock)}
}
export function reserve(file,metadata={}) {
  return transaction(file,d=>{
    const amount=d.ceilingPerRequestUsd
    const authorized=d.authorizedCapUsd??1
    if(d.blocked || !Number.isFinite(authorized) || authorized<=0 || !Number.isFinite(amount) || amount<=0 || !Number.isFinite(d.capUsd) || d.capUsd>authorized || d.capUsd<=0
      || d.chargedUpperBoundUsd+amount>d.capUsd) throw Error('Jev aggregate budget exhausted or blocked')
    const id=randomUUID();d.requests.push({...metadata,id,reservedUsd:amount,status:'reserved'})
    d.chargedUpperBoundUsd=Math.ceil((d.chargedUpperBoundUsd+amount)*1e12)/1e12
    return id
  })
}
export function settle(file,id,usage,metadata={}) {
  transaction(file,d=>{
    const entry=d.requests.find(r=>r.id===id)
    if(!entry || entry.status!=='reserved') throw Error('Invalid budget reservation')
    if(metadata.answers) entry.answers=metadata.answers
    if([401,402,403,429].includes(metadata.providerStatus)) {d.blocked=true;d.providerStatus=metadata.providerStatus}
    const tokens=usage?.input_tokens
    const reported=usage?.cost
    // Unknown usage retains full ceiling, including HTTP rejection/timeout.
    if(!Number.isInteger(tokens) || tokens<0) {entry.status='uncertain';return}
    const computed=tokens*d.promptUsdPerToken
    const cost=typeof reported==='number' && Number.isFinite(reported) && reported>=0 ? Math.max(reported,computed) : computed
    if(cost>entry.reservedUsd) {d.blocked=true;entry.status='price-bound-violation';return}
    d.chargedUpperBoundUsd=Math.ceil((d.chargedUpperBoundUsd-entry.reservedUsd+cost)*1e12)/1e12
    entry.status='settled';entry.accountedUsd=cost;entry.inputTokens=tokens
  })
}

export function installBudgetFetch(file,delegate=globalThis.fetch) {
  return async (input,init)=>{
    const url=String(input instanceof Request?input.url:input)
    const target=new URL(url)
    if(target.hostname!=='openrouter.ai') return delegate(input,init)
    if(target.pathname!=='/api/v1/systemone') throw Error('Unbudgeted OpenRouter endpoint blocked')
    const body=JSON.parse(init?.body ?? '{}')
    if(body.model!=='typesafe/jev-1.13') throw Error('Unbudgeted model blocked')
    const id=reserve(file,{
      queryHash:createHash('sha256').update(String(body.state?.query ?? '')).digest('hex'),
      requestHash:createHash('sha256').update(JSON.stringify(body)).digest('hex'),
      ...(process.env.SENSEGREP_RESEARCH_CAPTURE_MAP==='1' ? {sourceMap:Object.fromEntries(Object.entries(body.state?.candidates ?? {}).map(([id,c])=>[id,{
        file:c.file,symbol:c.symbol,callers:c.callers?.map(v=>({file:v.file,symbol:v.symbol})),
        sources:c.evidenceState?.sources?.map(v=>v.id),relations:c.relations?.map(v=>({caller:v.caller,target:v.target})),
      }]))} : {}),
    })
    try {
      const response=await delegate(input,init)
      const raw=await response.clone().json().catch(()=>null)
      const answers=response.ok && raw?.answers ? Object.fromEntries(Object.entries(raw.answers)
        .filter(([key])=>Object.hasOwn(body.questions ?? {},key)).map(([key,a])=>[key,{
          type:a.type,noul:a.noul,choice:a.choice,score:a.score,confidence:a.confidence,probabilities:a.probabilities,
        }])) : undefined
      settle(file,id,response.ok?raw?.usage:undefined,{answers,providerStatus:response.status})
      return response
    } catch(error) {settle(file,id,undefined);throw error}
  }
}
