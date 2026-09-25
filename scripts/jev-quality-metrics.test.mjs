import {test} from 'node:test'
import assert from 'node:assert/strict'
import {factMetrics,matchesSource} from './jev-quality-metrics.mjs'
test('accepts only reviewed alternatives and does not mistake a reference for the implementation',()=>{
  const fact={id:'value',anyOf:[{file:'a.ts',symbol:'LIMIT',includes:['= 30']},{file:'shared.ts',symbol:'LIMIT',includes:['= 30']}]}
  const rows=[{file:'shared.ts',symbol:'LIMIT',content:'export const LIMIT = 30'}]
  assert.equal(factMetrics([fact],rows).allFacts,true)
  assert.equal(matchesSource(rows[0],{file:'a.ts',symbol:'LIMIT'}),false)
  assert.equal(matchesSource(rows[0],{anyOf:fact.anyOf}),true)
  assert.equal(factMetrics([fact],[{...rows[0],content:'use(LIMIT)'}]).allFacts,false)
  assert.equal(factMetrics([fact],[{...rows[0],contentTruncated:true}]).allFacts,false)
  assert.equal(factMetrics([fact],[{...rows[0],file:'unreviewed.ts'}]).allFacts,false)
})
