import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {validateEvaluationManifest,referenceCoverage,classifyRetrievalLoss,summarizeReviewedRun,freezeEvaluationManifest} from './evaluation-contract.mjs'
const manifest=()=>({schemaVersion:1,id:'synthetic-contract-test',codeSha:'a'.repeat(40),indexSnapshot:'synthetic-index',indexConfigHash:'b'.repeat(64),model:{alias:'fixture',revision:'fixture-1'},
  cases:[{id:'q1',repository:'fixture/repo',repositorySha:'c'.repeat(40),family:'family1',query:'synthetic question',split:'dev',reviewed:true,negative:false,acceptableSourceSets:[['a','b'],['c']]}]})
test('validates an explicitly reviewed and frozen manifest',()=>assert.equal(validateEvaluationManifest(manifest()).cases,1))
test('rejects family leakage across snapshots and differently cased repository names',()=>{
  const m=manifest();m.cases.push({...m.cases[0],id:'q2',repository:'FIXTURE/REPO',repositorySha:'d'.repeat(40),split:'holdout'})
  assert.throws(()=>validateEvaluationManifest(m),/leakage/)
})
test('does not accept an empty positive gabarito as complete coverage',()=>{
  const m=manifest();m.cases[0].acceptableSourceSets=[[]]
  assert.throws(()=>validateEvaluationManifest(m),/nonempty/)
})
test('accepts an independently registered alternative source set',()=>assert.equal(referenceCoverage([['a','b'],['c']],['c']).complete,true))
test('never interprets absent telemetry as a retrieval miss',()=>assert.equal(classifyRetrievalLoss(manifest().cases[0],{selected:['a']}).classification,'insufficient-telemetry'))
test('locates a serialization loss when all preceding stages cover the sources',()=>{
  const stages={universe:['a','b'],nominated:['a','b'],assessed:['a','b'],selected:['a','b'],emitted:['a']}
  assert.equal(classifyRetrievalLoss(manifest().cases[0],stages).classification,'reference-loss:emitted')
})
test('keeps failed and missing cases in the run denominator',()=>{
  const m=manifest();m.cases.push({...m.cases[0],id:'q2',family:'family2',split:'holdout'})
  const result=summarizeReviewedRun(m,[{id:'q1',status:'failed',verdict:'not-assessed'}])
  assert.equal(result.total,2);assert.equal(result.failedOrMissing,2);assert.equal(result.positiveQueries,2)
})
test('freezing verifies artifacts and never overwrites an existing registration',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sensegrep-eval-contract-'))
  try {
    await fs.writeFile(path.join(dir,'source.json'),'{}')
    const m={...manifest(),artifacts:[{path:'source.json'}]},output=path.join(dir,'frozen.json')
    assert.equal(freezeEvaluationManifest(m,dir,output).artifacts,1)
    assert.throws(()=>freezeEvaluationManifest(m,dir,output),/EEXIST/)
    assert.throws(()=>freezeEvaluationManifest({...m,artifacts:[{path:'missing.json'}]},dir,path.join(dir,'other.json')),/ENOENT/)
  } finally {await fs.rm(dir,{recursive:true,force:true})}
})
