import {test} from 'node:test'
import assert from 'node:assert/strict'
import {discoveryRound} from './jev-discovery-round.mjs'
import {accepts} from './research-jev-sufficiency.mjs'
test('features cannot combine unrelated witnesses into a complete answer',()=>{
  assert.equal(accepts({available:true,witnessFeatures:[{a:.95,b:.1},{a:.1,b:.95}]},{features:['a','b'],threshold:.8}),false)
})
test('manual discovery excludes held-out labels and requires explicit screening',()=>{
  assert.throws(()=>discoveryRound({records:[{split:'test'}],questions:{},screening:{}}),/development/)
  assert.throws(()=>discoveryRound({records:[{split:'dev'}],questions:{a:{instructions:'Present?'}},screening:{}}),/screening/)
})
