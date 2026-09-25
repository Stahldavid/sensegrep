import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {sourceMetrics,summary} from './evaluate-jev-reviewed.mjs'
test('source coverage requires actual complete content, not just the symbol name',()=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'jev-source-'))
  try {
    const content='export function rule(x: number) { return x >= 30 }'
    writeFileSync(path.join(root,'rule.ts'),content)
    const c={required:[{file:'rule.ts',symbol:'rule'}],expectedFacts:[{id:'inclusive',description:'inclusive threshold'}]}
    assert.equal(sourceMetrics(c,[{file:'rule.ts',symbol:'rule',content:'rule'}],root).sourceRecall,0)
    assert.equal(sourceMetrics(c,[{file:'rule.ts',content}],root).sourceRecall,1)
    assert.equal(sourceMetrics(c,[{file:'rule.ts',content,contentTruncated:true}],root).sourceRecall,0)
  } finally {rmSync(root,{recursive:true,force:true})}
})
test('failures remain in denominator and unsupported direct answers are visible',()=>{
  const s=summary([{arm:'local',group:'a',answerExistsInScope:true,status:'failed'},
    {arm:'local',group:'b',answerExistsInScope:true,status:'complete',sourceRecall:1,completeReferenceSet:true},
    {arm:'local',group:'c',answerExistsInScope:false,status:'complete',verdict:'direct-evidence'}]).local
  assert.equal(s.macroFamilySourceRecall,.5);assert.equal(s.failed,1);assert.equal(s.falseCompleteProxy,1)
})
