import {test} from 'node:test'
import assert from 'node:assert/strict'
import {perturb,quality} from './evaluate-jev-frozen.mjs'
const rows=['a','b'].map(symbolName=>({file:`${symbolName}.ts`,startLine:1,endLine:1,content:'code',semanticScore:.5,metadata:{symbolName}}))
test('perturbations preserve candidate identities and never change the frozen source',()=>{
  assert.deepEqual(perturb(rows,'reverse'),[rows[1],rows[0]])
  assert.equal(perturb(rows,'distractor').length,3)
  assert.equal(rows.length,2)
  assert.equal(rows[0].metadata.symbolName,'a')
})
test('missing gold is a recall failure, not a successful negative decision',()=>{
  assert.deepEqual(quality({expected:'missing.ts'},rows).ranks,[0])
  assert.equal(quality({expected:'missing.ts'},rows).allRequired,false)
  assert.equal(quality({negative:true},rows).allRequired,null)
  assert.equal(quality({expected:'b.ts',symbol:'b'},rows).allRequired,true)
})
