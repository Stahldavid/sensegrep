import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const base = path.resolve(process.env.SENSEGREP_CORE_DIST ?? 'packages/core/dist')
const load = relative => import(pathToFileURL(path.join(base, relative)).href)
const { readProjectSource, sourceContentHash, validateSourceRange } = await load('file/source-reader.js')
const { createResultId, decodeResultId } = await load('tool/result-id.js')
const { runShowResult } = await load('tool/show-result.js')
const { selectSourcePackages } = await load('tool/packet-selection.js')
const { sameSource } = await load('tool/source-identity.js')
const { mergeStageDiagnostics } = await load('tool/stage-diagnostics.js')
const { RateLimiter, quotaLimiter, validateEmbeddingIndices } = await load('semantic/rate-limiter.js')
const { RefreshQueue } = await load('semantic/refresh-queue.js')
const { sendJevRequest, parseRetryAfter } = await load('tool/jev-transport.js')
const { AsyncSemaphore } = await load('util/async-control.js')
const { assertNetworkAllowed } = await load('util/network-policy.js')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(predicate) {
  const deadline = Date.now() + 2000
  while (!predicate()) { if (Date.now() >= deadline) throw new Error('Condition timeout'); await wait(2) }
}
async function fixture(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sensegrep-runtime-contract-'))
  const root = path.join(dir, 'project'); await fs.mkdir(root)
  try { await fn(root, dir) } finally { await fs.rm(dir, {recursive:true,force:true}) }
}
const row = (name, file = `${name}.ts`, startLine = 1, endLine = 3) => ({file,startLine,endLine,content:`function ${name}() { return 1 }`,metadata:{symbolName:name}})
const packet = (root, sources = [root]) => ({root,sources,candidate:root,bounded:false})

test('safe reader preserves UTF-8 and newline-normalized identity',()=>fixture(async root=>{
  await fs.writeFile(path.join(root,'a.ts'),'ação\r\nβ\n')
  const result=await readProjectSource(root,'a.ts')
  assert.equal(result.hash,sourceContentHash('ação\nβ\n'))
}))
test('safe reader rejects lexical and absolute escapes',()=>fixture(async root=>{
  for(const file of ['../outside','/etc/passwd','C:\\outside']) await assert.rejects(readProjectSource(root,file),{code:'outside-root'})
}))
test('safe reader rejects an external directory symlink or junction',t=>fixture(async(root,dir)=>{
  const outside=path.join(dir,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'a.ts'),'synthetic')
  try {await fs.symlink(outside,path.join(root,'linked'),process.platform==='win32'?'junction':'dir')}
  catch(error){if(error.code==='EPERM'){t.skip('Symlink creation denied by this runner');return}throw error}
  await assert.rejects(readProjectSource(root,'linked/a.ts'),{code:'unsafe-source'})
}))
test('safe reader bounds bytes and rejects binary data',()=>fixture(async root=>{
  await fs.writeFile(path.join(root,'large'),'12345')
  await assert.rejects(readProjectSource(root,'large',{maxBytes:4}),{code:'source-too-large'})
  await fs.writeFile(path.join(root,'binary'),Buffer.from([0,1]))
  await assert.rejects(readProjectSource(root,'binary'),{code:'binary-source'})
}))
test('safe reader honors a cancelled operation',()=>fixture(async root=>{
  await assert.rejects(readProjectSource(root,'a.ts',{signal:AbortSignal.abort()}),{name:'AbortError'})
}))
test('show rejects out-of-range and reversed source locations',()=>fixture(async root=>{
  await fs.writeFile(path.join(root,'a.ts'),'one line')
  assert.throws(()=>validateSourceRange(['one'],2,1),/range/)
  await assert.rejects(runShowResult({rootDir:root,resultId:createResultId({file:'a.ts',startLine:99,endLine:100})}),{code:'invalid-range'})
}))
test('show detects changed content with an unchanged symbol name',()=>fixture(async root=>{
  const original='function rule() { return 1 }';await fs.writeFile(path.join(root,'a.ts'),original)
  const resultId=createResultId({file:'a.ts',startLine:1,endLine:1,symbol:'rule',sourceHash:sourceContentHash(original)})
  assert.equal((await runShowResult({rootDir:root,resultId})).freshness.targetFresh,true)
  await fs.writeFile(path.join(root,'a.ts'),'function rule() { return 2 }')
  assert.equal((await runShowResult({rootDir:root,resultId})).status,'stale-location')
}))
test('legacy result IDs do not claim verified freshness',()=>fixture(async root=>{
  await fs.writeFile(path.join(root,'a.ts'),'function rule() {}')
  assert.equal((await runShowResult({rootDir:root,resultId:createResultId({file:'a.ts',startLine:1,endLine:1})})).freshness.targetFresh,null)
}))
test('extended result identities roundtrip without breaking the compact legacy format',()=>{
  const original={file:'a.ts',startLine:1,endLine:2,symbol:'x',sourceHash:'a'.repeat(64),snapshotId:'table:1'}
  assert.deepEqual(decodeResultId(createResultId(original)),original)
  assert.deepEqual(decodeResultId(createResultId({file:'a.ts',startLine:1,endLine:2})),{file:'a.ts',startLine:1,endLine:2})
})
test('partial range overlap never silently drops a containing package root',()=>{
  const a=row('method','x.ts',10,20),b=row('root','x.ts',1,100),c=row('helper')
  const result=selectSourcePackages([packet(a),packet(b,[b,c])],5,100,()=>10)
  assert.equal(result.selected.length,2);assert.deepEqual(result.results,[a,b,c])
})
test('a package that cannot fit is rejected atomically',()=>{
  const a=row('a'),b=row('b'),c=row('c')
  const result=selectSourcePackages([packet(a),packet(b,[b,c])],5,20,()=>10)
  assert.deepEqual(result.results,[a]);assert.equal(result.rejected[0].reason,'token-budget')
})
test('strict physical file limits are applied before package admission',()=>{
  const a=row('a','same.ts'),b=row('b','same.ts',4,6)
  assert.equal(selectSourcePackages([packet(a,[a,b])],1,100,()=>10,{maxPerFile:1}).results.length,0)
  assert.equal(selectSourcePackages([packet(a,[a,b])],1,100,()=>10,{maxPerFile:0}).results.length,2)
})
test('conflicting source content is never admitted as the same identity',()=>{
  const a=row('a'),b={...a,content:'different source'}
  assert.equal(selectSourcePackages([packet(a,[a,b])],1,100,()=>10).rejected[0].reason,'source-conflict')
})
test('shared identical sources consume the budget once',()=>{
  const a=row('a'),b=row('b'),shared=row('helper')
  const result=selectSourcePackages([packet(a,[a,shared]),packet(b,[b,shared])],2,30,()=>10)
  assert.equal(result.results.length,3);assert.equal(result.estimatedTokens,30)
})
test('package admission invariants hold across a deterministic range/budget matrix',()=>{
  for(let count=1;count<=12;count++) for(let budget=0;budget<=100;budget+=10){
    const packets=Array.from({length:count},(_,i)=>{const root=row(`s${i}`,'x.ts',i+1,i+10);return packet(root,[root,row(`h${i%3}`)])})
    const result=selectSourcePackages(packets,5,budget,()=>10)
    assert.ok(result.estimatedTokens<=budget);assert.ok(result.selected.length<=5)
    for(const selected of result.selected)for(const source of selected.sources) assert.ok(result.results.some(r=>sameSource(r,source)))
  }
})
test('aggregate status preserves a later verification failure',()=>{
  const base={status:'complete',models:[],requests:1,cacheHits:0,inputTokens:1,outputTokens:1,cost:.1,elapsedMs:1,evaluated:1,candidates:1}
  const target={...base};mergeStageDiagnostics(target,{...base,status:'fallback',evaluated:0,reason:'invalid-response',unknownUsageRequests:1})
  assert.equal(target.status,'partial');assert.ok(target.reasons.includes('invalid-response'));assert.equal(target.usageComplete,false)
})
test('rate limiting rejects a batch larger than total quota capacity',async()=>{
  await assert.rejects(new RateLimiter(10,5).acquire(6),/capacity/)
})
test('rate limiting expires a queued request against its original deadline',async()=>{
  const limiter=new RateLimiter(1,10);await limiter.acquire(1)
  await assert.rejects(limiter.acquire(1,{deadlineAt:Date.now()+5}),{name:'TimeoutError'})
})
test('rate limiting cancellation removes queued work',async()=>{
  const limiter=new RateLimiter(1,10,20);await limiter.acquire(1)
  const abort=new AbortController(),pending=limiter.acquire(1,{signal:abort.signal});abort.abort()
  await assert.rejects(pending,{name:'AbortError'})
  await limiter.acquire(1,{deadlineAt:Date.now()+1000})
})
test('quota registry shares only the same provider account identity',async()=>{
  const identity={provider:'synthetic',credential:'one'}
  const a=quotaLimiter(identity,10,100);await a.acquire(1)
  assert.equal(quotaLimiter(identity,10,100),a);assert.notEqual(quotaLimiter({...identity,credential:'two'},10,100),a)
})
test('embedding indices and numeric coordinates are validated without coercion',()=>{
  assert.throws(()=>validateEmbeddingIndices([{index:0,embedding:[1]},{index:0,embedding:[2]}],2),/index/)
  assert.throws(()=>validateEmbeddingIndices([{index:0,embedding:['1']}],1),/finite/)
  assert.throws(()=>validateEmbeddingIndices([],1),/incomplete/)
  assert.deepEqual(validateEmbeddingIndices([{index:1,embedding:[1]},{index:0,embedding:[2]}],2).map(r=>r.index),[0,1])
})
const endpoint='https://openrouter.ai/api/v1/systemone'
const opts=fetcher=>({apiKey:'synthetic-test-credential',signal:AbortSignal.timeout(2000),fetch:fetcher,onAttempt:()=>{}})
test('Jev does not retry or split arbitrary HTTP 400 responses',async()=>{
  let calls=0;await assert.rejects(sendJevRequest(endpoint,'{}',opts(async()=>{calls++;return Response.json({error:{code:'invalid_question'}},{status:400})})),{code:'invalid-request'})
  assert.equal(calls,1)
})
test('Jev distinguishes actual context overflow',async()=>{
  await assert.rejects(sendJevRequest(endpoint,'{}',opts(async()=>Response.json({error:{code:'context_length_exceeded'}},{status:400}))),{code:'context-overflow'})
})
test('Jev never retries authorization or credit failures',async()=>{
  for(const status of [401,402,403]){let calls=0;await assert.rejects(sendJevRequest(endpoint,'{}',opts(async()=>{calls++;return new Response('',{status})})),{code:`provider-rejected-${status}`});assert.equal(calls,1)}
})
test('Jev honors a short retry delay but never shortens a long Retry-After',async()=>{
  let calls=0
  await sendJevRequest(endpoint,'{}',opts(async()=>++calls===1?new Response('',{status:503,headers:{'retry-after':'0'}}):Response.json({answers:{}})))
  assert.equal(calls,2)
  calls=0;await assert.rejects(sendJevRequest(endpoint,'{}',opts(async()=>{calls++;return new Response('',{status:429,headers:{'retry-after':'60'}})})),{code:'provider-rejected-429'});assert.equal(calls,1)
  assert.equal(parseRetryAfter('-1'),undefined)
})
test('Jev concurrency is bounded across independent evaluations',async()=>{
  let active=0,peak=0
  const fetcher=async()=>{active++;peak=Math.max(peak,active);await wait(5);active--;return Response.json({answers:{}})}
  await Promise.all(Array.from({length:12},()=>sendJevRequest(endpoint,'{}',opts(fetcher))))
  assert.ok(peak<=4);assert.ok(peak>1)
})
test('local-only network policy accepts loopback but rejects remote and lookalike hosts',()=>{
  const env={SENSEGREP_NETWORK_POLICY:'local-only'}
  assert.doesNotThrow(()=>assertNetworkAllowed('http://127.0.0.1:11434',env))
  assert.throws(()=>assertNetworkAllowed('https://127.0.0.1.example.invalid',env),/local-only/)
  assert.throws(()=>assertNetworkAllowed(endpoint,env),/local-only/)
})
test('semaphore cancellation removes a waiter without leaking a permit',async()=>{
  const semaphore=new AsyncSemaphore(1),release=await semaphore.acquire()
  const abort=new AbortController(),pending=semaphore.acquire(abort.signal);abort.abort();await assert.rejects(pending)
  release();(await semaphore.acquire())()
})
test('refresh queue retries a failed generation without a new filesystem event',async()=>{
  let calls=0;const queue=new RefreshQueue({intervalMs:3,run:async()=>{if(++calls===1)throw new Error('transient')}})
  try{queue.markDirty();await until(()=>calls===2&&!queue.state.running);assert.equal(queue.state.pending,false)}finally{await queue.stop()}
})
test('refresh queue preserves edits arriving during a successful run',async()=>{
  let calls=0,release;const gate=new Promise(resolve=>{release=resolve})
  const queue=new RefreshQueue({intervalMs:3,run:async()=>{if(++calls===1)await gate}})
  try{queue.markDirty();await until(()=>calls===1);queue.markDirty();release();await until(()=>calls===2&&!queue.state.running);assert.equal(queue.state.pending,false)}finally{release();await queue.stop()}
})
test('refresh queue stops after repeated failures and reopens on a new edit',async()=>{
  let calls=0,healthy=false;const queue=new RefreshQueue({intervalMs:2,maxFailures:2,run:async()=>{calls++;if(!healthy)throw new Error('failed')}})
  try{queue.markDirty();await until(()=>queue.state.paused);assert.equal(calls,2);healthy=true;queue.markDirty();await until(()=>calls===3&&!queue.state.running);assert.equal(queue.state.pending,false)}finally{await queue.stop()}
})
test('refresh queue stop cancels and awaits the active operation',async()=>{
  let started=false,completed=false
  const queue=new RefreshQueue({intervalMs:2,run:async signal=>{started=true;await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));await wait(3);completed=true}})
  queue.markDirty();await until(()=>started);await queue.stop();assert.equal(completed,true);assert.equal(queue.state.stopped,true)
})
