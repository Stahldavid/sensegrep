import {describe,it,expect} from 'vitest'
import {routeEvidence,jevStages,labelEvidence} from './jev-routing.js'
import {recoverEvidenceBeam} from './jev-beam.js'
import {evidenceKey} from './jev-coverage.js'
import type {WorkingResult} from './sensegrep-pipeline.js'
const row=(name:string, parent?:WorkingResult):WorkingResult=>({file:`${name}.ts`,startLine:1,endLine:3,content:'source',metadata:{symbolName:name},semanticScore:.8,
  jev:{relevant:.9,evidence:.9,contradiction:0,role:'implementation'},
  ...(parent?{evidenceRelations:[{caller:evidenceKey(parent),file:parent.file,line:2,target:name,kind:'call',callsite:'call()',callerSignature:'function root()',resolved:true}]}:{})})
describe('evidence routing and bounded graph traversal',()=>{
  it('spends a small recovery budget on the leading caller rather than storage order',async()=>{
    const primary=row('primary'),secondary=row('secondary')
    const unrelated=row('storageFirst',secondary),helper=row('needed',primary)
    const run=await recoverEvidenceBeam([primary,secondary],[],{depth:1,width:2,maxCandidates:1,deadline:Date.now()+1000},
      async()=>[unrelated,helper],async rows=>rows)
    expect(run.results.map(r=>r.file)).toEqual(['needed.ts'])
  })
  it('re-evaluates retrieved but unassessed dependencies',async()=>{
    const parent=row('parent'),helper=row('helper',parent)
    const run=await recoverEvidenceBeam([parent],[{...helper,jev:undefined}],{depth:1,width:1,maxCandidates:1,deadline:Date.now()+1000},
      async()=>[helper],async rows=>rows)
    expect(run.results).toEqual([helper])
  })
  it('preserves conflicts and uncertainty without deleting rows',()=>{
    expect(routeEvidence()).toBe('unassessed')
    expect(routeEvidence({...row('a').jev!,evidence:.05,contradiction:.95})).toBe('contradicting')
    expect(routeEvidence(row('a').jev,true)).toBe('unassessed')
    expect(labelEvidence([row('a'),{...row('b'),jev:undefined}])).toHaveLength(2)
    expect(routeEvidence({...row('a').jev!,role:'test'})).toBe('test')
    expect(routeEvidence({...row('a').jev!,role:'helper'})).toBe('supporting')
  })
  it('separates all three stages and respects off',()=>{
    expect(jevStages('both',['recovery'])).toEqual({ranking:false,evidence:false,recovery:true})
    expect(jevStages('off',['recovery'])).toEqual({ranking:false,evidence:false,recovery:false})
    expect(jevStages('both')).toEqual({ranking:true,evidence:true,recovery:true})
  })
  it('follows a second branch to required code, ignores invented edges and terminates cycles',async()=>{
    const a=row('root'),b=row('first',a),c=row('second',a),d=row('target',c),fake=row('fake')
    const run=await recoverEvidenceBeam([a],[a,b],{depth:3,width:2,maxCandidates:8,deadline:Date.now()+1000},async parents=>
      parents.flatMap(p=>p.file===a.file?[b,c,fake]:p.file===c.file?[d]:p.file===d.file?[{...a,evidenceRelations:d.evidenceRelations}]:[]),async rows=>rows)
    expect(run.results.map(r=>r.file)).toEqual(['second.ts','target.ts'])
    expect(run.evaluated).toBe(3)
  })
  it('honors candidate budget and incomplete judging',async()=>{
    const a=row('root'),children=Array.from({length:8},(_,i)=>row(`c${i}`,a))
    const run=await recoverEvidenceBeam([a],[a],{depth:3,width:2,maxCandidates:2,deadline:Date.now()+1000},async()=>children,async rows=>rows)
    expect(run.evaluated).toBe(2);expect(run.status).toBe('candidate-limit')
    const failed=await recoverEvidenceBeam([a],[a],{depth:3,width:2,maxCandidates:2,deadline:Date.now()+1000},async()=>children,async()=>[])
    expect(failed.results).toEqual([]);expect(failed.status).toBe('evaluation-unavailable')
  })
  it('does not call expansion after deadline or cancellation',async()=>{
    const a=row('a'),options={depth:3,width:2,maxCandidates:5,deadline:Date.now()-1}
    const unexpected=async()=>{throw new Error('must not be invoked')}
    expect((await recoverEvidenceBeam([a],[a],options,unexpected,unexpected)).status).toBe('deadline')
    await expect(recoverEvidenceBeam([a],[a],{...options,signal:AbortSignal.abort()},unexpected,unexpected)).rejects.toThrow()
  })
})
