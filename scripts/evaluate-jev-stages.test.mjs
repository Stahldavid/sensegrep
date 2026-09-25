import {test} from 'node:test'
import assert from 'node:assert/strict'
import {coverageMetrics,ARMS,PROMOTION_ARMS} from './evaluate-jev-stages.mjs'
test('coverage scores missing helpers as misses and discounts late evidence',()=>{
  const required=[{file:'a',symbol:'rule'},{file:'a',symbol:'helper'}]
  const result=coverageMetrics(required,[{file:'a',symbol:'rule'},{file:'b',symbol:'noise'}])
  assert.equal(result.requiredRecall,.5);assert.equal(result.allRequired,false)
  assert.equal(result.mrr,1);assert.ok(result.ndcg<1)
  assert.equal(Object.keys(ARMS).length,9)
  assert.deepEqual(PROMOTION_ARMS.verification,ARMS.all)
  assert.deepEqual(PROMOTION_ARMS.deep,ARMS.all)
})
