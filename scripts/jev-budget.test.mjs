import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {reserve,settle,installBudgetFetch} from './jev-budget.mjs'
function fixture(fn){const dir=mkdtempSync(path.join(os.tmpdir(),'jev-budget-'));const file=path.join(dir,'ledger.json')
  writeFileSync(file,JSON.stringify({capUsd:.5,ceilingPerRequestUsd:.2,promptUsdPerToken:.01,chargedUpperBoundUsd:0,requests:[]}))
  return Promise.resolve().then(()=>fn(file)).finally(()=>rmSync(dir,{recursive:true,force:true}))}
test('concurrent reservations and uncertain attempts cannot exceed the cap',()=>fixture(file=>{
  reserve(file);const second=reserve(file);assert.throws(()=>reserve(file),/budget/)
  settle(file,second,undefined);assert.throws(()=>reserve(file),/budget/)
}))
test('known usage releases only unused reservation',()=>fixture(file=>{
  const id=reserve(file);settle(file,id,{input_tokens:5,cost:.04})
  assert.equal(JSON.parse(readFileSync(file)).chargedUpperBoundUsd,.05)
}))

test('a recorded higher authorization does not reset spent funds or allow exceeding its ceiling',()=>fixture(file=>{
  const d=JSON.parse(readFileSync(file));d.authorizedCapUsd=1.98;d.capUsd=1.98;d.chargedUpperBoundUsd=1.7
  writeFileSync(file,JSON.stringify(d));reserve(file)
  assert.equal(JSON.parse(readFileSync(file)).chargedUpperBoundUsd,1.9)
  assert.throws(()=>reserve(file),/budget/)
  d.capUsd=2;writeFileSync(file,JSON.stringify(d));assert.throws(()=>reserve(file),/budget/)
}))
test('quota rejection stops later calls and retains uncertain charge',()=>fixture(async file=>{
  let calls=0;const fetcher=installBudgetFetch(file,async()=>{calls++;return new Response('{}',{status:403})})
  const args=['https://openrouter.ai/api/v1/systemone',{body:JSON.stringify({model:'typesafe/jev-1.13'})}]
  await fetcher(...args);await assert.rejects(fetcher(...args),/budget/);assert.equal(calls,1)
}))

test('an authorized extension preserves spent funds and invalid ceilings fail closed',()=>fixture(file=>{
  const d=JSON.parse(readFileSync(file));d.capUsd=1;d.chargedUpperBoundUsd=.85
  writeFileSync(file,JSON.stringify(d));assert.throws(()=>reserve(file),/budget/)
  d.chargedUpperBoundUsd=.7;writeFileSync(file,JSON.stringify(d));reserve(file)
  assert.equal(JSON.parse(readFileSync(file)).chargedUpperBoundUsd,.9)
  for(const cap of [null,1.01,0]) {d.capUsd=cap;writeFileSync(file,JSON.stringify(d));assert.throws(()=>reserve(file),/budget/)}
}))
