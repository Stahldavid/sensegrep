import {test} from 'node:test'
import assert from 'node:assert/strict'
import {measure,selectPolicy} from './research-jev-sufficiency.mjs'
import {witnessCases} from './fixtures/jev-witness-cases.mjs'
test('feature selection rejects held-out observations',()=>{
  assert.throws(()=>selectPolicy([{split:'test'}]),/Development-only/)
  const dev=new Set(witnessCases('dev').map(c=>c.group))
  assert.ok(witnessCases('test').every(c=>!dev.has(c.group)))
})
test('false completeness dominates accepting more positive examples',()=>{
  const common={split:'dev',group:'behavior',available:true}
  const selected=selectPolicy([
    {...common,expectedComplete:true,features:{answer_present:.95,delegation_closed:.5,value_grounded:.5}},
    {...common,expectedComplete:true,features:{answer_present:.95,delegation_closed:.95,value_grounded:.95}},
    {...common,expectedComplete:false,features:{answer_present:.95,delegation_closed:.05,value_grounded:.05}},
  ])
  assert.equal(selected.metrics.falseComplete,0)
  assert.equal(selected.metrics.trueComplete,.5)
})
test('paraphrase counts cannot dominate family metrics; failures stay visible',()=>{
  const small={group:'small',expectedComplete:false,accepted:true,available:true}
  const large={group:'large',expectedComplete:false,accepted:false,available:false}
  assert.equal(measure([small,...Array(20).fill(large)]).falseComplete,.5)
  assert.equal(measure([small,large]).unavailable,1)
})
