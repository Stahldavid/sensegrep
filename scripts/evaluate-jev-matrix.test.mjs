import {test} from 'node:test'
import assert from 'node:assert/strict'
import {pairedInterval,summarize} from './evaluate-jev-matrix.mjs'
test('bootstrap keeps paired rule groups and is deterministic',()=>{
  const rows=['pt','en'].map(name=>({name,group:'same-rule',a:{hit:0},b:{hit:1}}))
  const interval=pairedInterval(rows,'a','b',r=>r.hit)
  assert.equal(interval.groups,1);assert.equal(interval.lower,1);assert.equal(interval.upper,1)
  assert.deepEqual(interval,pairedInterval(rows,'a','b',r=>r.hit))
})
test('four-arm summary does not confuse positive sufficiency with missing evidence',()=>{
  const arms=['old-local','new-local','old-jev','new-jev']
  const row={name:'negative',negative:true,...Object.fromEntries(arms.map(a=>[a,{ms:1,allRequired:false,verdict:'direct-evidence',jev:{cost:.01,requests:1}}]))}
  const s=summarize([row],arms)
  assert.equal(s.arms['new-jev'].falseSufficiency,1)
  assert.equal(s.arms['new-jev'].allRequired,0)
  assert.equal(s.arms['new-jev'].cost,.01)
})
