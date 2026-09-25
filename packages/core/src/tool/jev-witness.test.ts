import {describe,it,expect} from 'vitest'
import {orderDependencyInspection,buildWitnesses,dependencyObligations,pendingObligations,packObligations,gateWitnessAssessment,necessityDecision,sourceHash,packetFingerprint} from './jev-witness.js'
import {evidenceKey} from './jev-coverage.js'
import {assessJevPacket} from './jev.js'
import type {WorkingResult} from './sensegrep-pipeline.js'

const row=(name:string,content:string):WorkingResult=>({file:`${name}.ts`,startLine:1,endLine:content.split('\n').length,
  content,semanticScore:.8,metadata:{symbolName:name},jev:{relevant:.9,evidence:.9,contradiction:0}})
const caller=row('validate','function validate(value) {\n  if (parse(value) === null) throw Error("invalid")\n  return value\n}')
const parser=row('parse','function parse(value) {\n  const hour = Number(value)\n  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null\n  return hour\n}')
parser.evidenceRelations=[{caller:evidenceKey(caller),file:caller.file,line:2,target:'parse.ts:parse',kind:'call',resolved:true,
  callsite:'parse(value)',callerSignature:'validate(value)',callerContent:caller.content}]
parser.jev={...parser.jev!,dimensions:{dependency:.95}}

describe('source-bound requirements and dependency obligations',()=>{
  it('prioritizes dependencies of a selected helper over entry-point scaffolding',()=>{
    const leaf=row('leaf','function leaf(){return 1}'),incidental=row('setup','function setup(){return 0}')
    leaf.evidenceRelations=[{...parser.evidenceRelations![0],caller:evidenceKey(parser),target:'leaf'}]
    incidental.evidenceRelations=[{...parser.evidenceRelations![0],target:'setup'}]
    expect(orderDependencyInspection([incidental,leaf],[caller,parser])).toEqual([leaf,incidental])
  })
  it('invalidates the packet when same-ID content, relation, requirement or inspection changes',()=>{
    const base=packetFingerprint('rule',[caller],[])
    for(const other of [packetFingerprint('other',[caller],[]),packetFingerprint('rule',[{...caller,content:'changed'}],[]),
      packetFingerprint('rule',[{...caller,requiredBy:['new']}],[]),packetFingerprint('rule',[caller],[],{status:'partial'})]) expect(other).not.toBe(base)
  })
  it('marks only requirements connected to an unresolved dependency',()=>{
    const pending=[{...dependencyObligations([parser],[caller])[0],requirementIds:['a1']}]
    const result=gateWitnessAssessment({verdict:'direct-evidence',missingAspects:[] as string[]},pending,true,
      [{id:'a0',text:'unrelated rule',origin:'query'},{id:'a1',text:'valid hours',origin:'query'}])
    expect(result.missingAspects).toEqual(['valid hours'])
  })
  it('identifies full AST statements without cutting the enclosing function',async()=>{
    const witnesses=await buildWitnesses([caller,parser])
    const root=witnesses.find(w=>w.root===evidenceKey(caller))!
    const state=root.row.evidenceState!
    expect(root.sources.map(s=>s.id)).toEqual([evidenceKey(parser),evidenceKey(caller)].sort())
    expect(state.sources.find((s:any)=>s.id===evidenceKey(parser)).landmarks).toContainEqual(expect.objectContaining({startLine:3,endLine:3,guard:true,hash:sourceHash(parser)}))
    expect(state.sources.find((s:any)=>s.id===evidenceKey(parser)).content).toBe(parser.content)
  })
  it('retains identical witnesses under reordering and unrelated distraction',async()=>{
    const base=await buildWitnesses([caller,parser])
    const changed=await buildWitnesses([row('noise','const color = "blue"'),parser,caller])
    for(const w of base) expect(changed.find(c=>c.root===w.root)).toEqual(w)
  })
  it('does not substitute a same-valued unreferenced constant',async()=>{
    const root=row('rule','function rule(x) { return x < LIMIT }')
    const literal={...row('limit','const LIMIT = 23'),requiredBy:[evidenceKey(root)]}
    const other=row('unrelated','const LIMIT = 23')
    const before=(await buildWitnesses([root,literal,other])).find(w=>w.root===evidenceKey(root))!
    const after=(await buildWitnesses([root,other])).find(w=>w.root===evidenceKey(root))!
    expect(before.sources).toHaveLength(2)
    expect(after.sources).toEqual([{id:evidenceKey(root),hash:sourceHash(root)}])
    expect(after.row.content).not.toContain('const LIMIT = 23')
  })
  it('invalidates a dependency after removal, truncation or same-ID content mutation',()=>{
    const obligations=dependencyObligations([parser],[caller])
    expect(pendingObligations(obligations,[caller,parser])).toEqual([])
    for(const selected of [[caller],[caller,{...parser,contentTruncated:true}],[caller,{...parser,content:'function parse() {return 42}'}]]) {
      const pending=pendingObligations(obligations,selected)
      expect(pending).toHaveLength(1)
      expect(gateWitnessAssessment({verdict:'direct-evidence',missingAspects:[]},pending,true,['valid hours']).verdict).toBe('partial-evidence')
    }
  })
  it('does not confuse unknown or uncertain necessity with rejection',()=>{
    expect([undefined,.05,.5,.95].map(necessityDecision)).toEqual(['not-assessed','not-required','uncertain','required'])
    const unknown={...parser,jev:undefined}
    expect(pendingObligations(dependencyObligations([unknown],[caller]),[caller])).toHaveLength(1)
    expect(gateWitnessAssessment({verdict:'direct-evidence',missingAspects:[]},[],false,['rule']).reason).toBe('dependency-inspection-incomplete')
    expect(gateWitnessAssessment({verdict:'no-evidence-found',missingAspects:[]},[],false,['rule']).verdict).toBe('no-evidence-found')
  })
  it('replaces peripheral tails without evicting the necessary caller or exceeding either cap',()=>{
    const noise=row('noise','function noise() {return 1}')
    const obligations=dependencyObligations([parser],[caller])
    expect(packObligations([caller,noise],[parser],obligations,200,2,()=>100).results).toEqual([caller,parser])
    expect(packObligations([caller],[parser],obligations,100,2,()=>100).results).toEqual([caller])
    expect(packObligations([caller],[parser],obligations,200,1,()=>100).results).toEqual([caller])
    expect(packObligations([caller],[{...parser,contentTruncated:true}],obligations,200,2,()=>100).results).toEqual([caller])
  })
  it('rejects missing-parser completeness while preserving a narrower caller-only question',async()=>{
    // Behavioral oracle for the transport contract, not an accuracy claim about
    // Jev. The live metamorphic suite separately measures actual model behavior.
    const fetcher:typeof fetch=async(_url,init)=>{
      const body=JSON.parse(init!.body as string), source=JSON.stringify(body.state.candidates.c0.evidenceState)
      const supports=body.state.query.includes('where rejection') ? source.includes('throw Error') : source.includes('hour > 23')
      return Response.json({answers:Object.fromEntries(Object.entries(body.questions).map(([id,q])=>{
        const question=q as any
        const keys=Object.keys(question.criteria ?? {})
        const choice=keys.includes('supports') ? supports?'supports':'says_nothing'
          : keys.includes('missing_definition') ? supports?'none':'missing_definition' : keys[0]
        return [id,question.type==='choice'?{type:'choice',choice,confidence:1,
          probabilities:Object.fromEntries(keys.map(k=>[k,k===choice?1:0]))}:
          {type:'noul',noul:id.endsWith('contradiction')?0:.95}]
      }))})
    }
    const deps={fetch:fetcher,apiKey:'test',cache:false},options={mode:'evidence' as const}
    const full=await assessJevPacket('which hours are valid',[caller,parser],options,deps)
    const removed=await assessJevPacket('which hours are valid',[caller],options,deps)
    const narrow=await assessJevPacket('where rejection happens',[caller],options,deps)
    expect(full.verdict).toBe('direct-evidence')
    expect(removed.verdict).toBe('partial-evidence')
    expect(removed.coverage[0].witnesses).toEqual([])
    expect(narrow.verdict).toBe('direct-evidence')
    expect(full.packetHash).not.toBe(removed.packetHash)
  })
})
