import {describe,it,expect} from 'vitest'
import {implementationPackages,selectImplementationPackages,seedImplementationPackages,evaluateImplementationContext,packageShortlist,packageDiscoveryCards} from './jev-packages.js'
import {TreeSitterChunking} from '../semantic/chunking-treesitter.js'
import {evidenceKey,evidenceAspects} from './jev-coverage.js'
import type {WorkingResult} from './sensegrep-pipeline.js'
const source=(name:string):WorkingResult=>({file:`${name}.ts`,startLine:1,endLine:3,content:`function ${name}(){return true}`,
  metadata:{symbolName:name},semanticScore:.7})
const child=(name:string,parent:WorkingResult):WorkingResult=>({...source(name),requiredBy:[evidenceKey(parent)]})
describe('implementation packages',()=>{
  it('keeps the named workflow caller with its parser, without preferring wrappers for a parser-only query',()=>{
    const caller=source('fetchStatus'),parser=child('parse',caller),other=source('other')
    const packets=implementationPackages([parser,other,caller],[parser,other,caller])
    const scores=new Map([parser,other,caller].map(r=>[evidenceKey(r),{evidence:.95,dimensions:{root_operation:r===caller?.3:.9}}]))
    expect(seedImplementationPackages(packets,scores,2,4000,'status').selected.map(p=>p.root.metadata.symbolName)).toEqual(['parse','fetchStatus'])
    expect(seedImplementationPackages(packets,scores,2,4000,'parse').selected.map(p=>p.root.metadata.symbolName)).toEqual(['parse','other'])
  })
  it('preserves a third strong implementation without admitting a weak variant or exceeding the budget',()=>{
    const roots=['first','second','variant','weak'].map(source),packets=implementationPackages(roots,roots)
    const scores=new Map(roots.map((r,i)=>[evidenceKey(r),{evidence:.95,dimensions:{root_operation:i===3?.2:.9}}]))
    const selected=seedImplementationPackages(packets,scores,5,4000)
    expect(selected.selected.map(p=>p.root.metadata.symbolName)).toEqual(['first','second','variant'])
    expect(seedImplementationPackages(packets,scores,2,4000).selected).toHaveLength(2)
    expect(seedImplementationPackages(packets,scores,5,1).estimatedTokens).toBe(0)
  })
  it('retains both retrieval orders even when a later consumer takes only a prefix',()=>{
    const local=source('local'),semantic={...source('semantic'),semanticScore:.99}
    const rows=[local,...Array.from({length:40},(_,i)=>source(`other${i}`)),semantic]
    expect(packageShortlist(rows,64).slice(0,2).map(evidenceKey)).toEqual([evidenceKey(local),evidenceKey(semantic)])
  })
  it('exposes low-ranked sources in bounded discovery cards without assigning evidence scores',()=>{
    const rows=Array.from({length:150},(_,i)=>({...source(`s${i}`),file:`file${Math.floor(i/3)}.ts`}))
    const cards=packageDiscoveryCards(rows)
    expect(cards).toHaveLength(50)
    expect(cards.at(-1)?.content).toContain('s149')
    expect(cards.every(r=>!r.jev)).toBe(true)
  })
  it('does not lose a file just beyond the former 80-file discovery boundary',()=>{
    const cards=packageDiscoveryCards(Array.from({length:170},(_,i)=>source(`file${i}`)))
    expect(cards).toHaveLength(160)
    expect(cards[80].content).toContain('file80')
  })
  it('retains a semantic leader displaced by local heuristic ordering',()=>{
    const noise=Array.from({length:40},(_,i)=>({...source(`noise${i}`),semanticScore:.1}))
    const rule={...source('rule'),semanticScore:.9}
    expect(packageShortlist([...noise,rule],24).map(evidenceKey)).toContain(evidenceKey(rule))
    expect(packageShortlist([...noise,rule],24)).toHaveLength(24)
  })
  it('resolves imported values and local constants without reading strings as references',async()=>{
    const code='import { Time as Clock } from "./time"\nconst LIMIT = 2\nfunction wait() { return Clock.HOUR * LIMIT + "Clock.MINUTE" }'
    const refs=await TreeSitterChunking.evidenceReferences(code,'wait.ts')
    expect(refs).toEqual(expect.arrayContaining([
      expect.objectContaining({target:'Time',module:'./time',line:3,reference:true}),
      expect.objectContaining({target:'LIMIT',line:3,reference:true}),
    ]))
    expect(refs.filter(r=>r.target==='Time')).toHaveLength(1)
    expect(await TreeSitterChunking.evidenceReferences('import { Time } from "./time"\nfunction wait(Time) { return Time.HOUR }','wait.ts')).toEqual([])
  })
  it('keeps distinct encrypt and decrypt operations even when equally useful',()=>{
    const encrypt=source('encrypt'),decrypt=source('decrypt'),key=child('key',encrypt)
    const packets=implementationPackages([encrypt,decrypt],[encrypt,decrypt,key])
    const picked=selectImplementationPackages(packets,2,300,()=>100)
    expect(picked.results).toEqual([encrypt,key,decrypt])
    expect(picked.selected).toHaveLength(2)
    expect(picked.estimatedTokens).toBe(300)
  })
  it('admits a six-source package atomically under a one-package limit',()=>{
    const root=source('root'),helpers=Array.from({length:5},(_,i)=>child(`h${i}`,root))
    const packets=implementationPackages([root],[root,...helpers])
    expect(selectImplementationPackages(packets,1,600,()=>100).results).toHaveLength(6)
    expect(selectImplementationPackages(packets,1,599,()=>100).results).toHaveLength(0)
  })
  it('shares dependencies without double charging or merging physical locations',()=>{
    const a=source('web'),b=source('mobile'),helper={...source('shared'),requiredBy:[evidenceKey(a),evidenceKey(b)]}
    const result=selectImplementationPackages(implementationPackages([a,b],[a,b,helper]),2,300,()=>100)
    expect(result.results).toEqual([a,helper,b]);expect(result.estimatedTokens).toBe(300)
  })
  it('terminates cyclic graphs and records bounded expansion',()=>{
    const a=source('a'),b=child('b',a);a.requiredBy=[evidenceKey(b)]
    expect(implementationPackages([a],[a,b])[0].sources).toHaveLength(2)
    expect(implementationPackages([a],[a,b],1)[0].bounded).toBe(true)
  })
  it('materializes more than four exact constants across roots',()=>{
    const roots=Array.from({length:6},(_,i)=>({...source(`root${i}`),bundleSources:[{file:`c${i}.ts`,symbol:`C${i}`,startLine:1,endLine:1,content:`const C${i}=1`}]}))
    expect(implementationPackages(roots,roots).every(p=>p.sources.length===2)).toBe(true)
  })
  it('does not call the provider again after rejected initial evaluation',async()=>{
    let calls=0
    const fetcher:typeof fetch=async()=>{calls++;return new Response('{}',{status:403})}
    const result=await evaluateImplementationContext('where is the rule',[source('rule')],{
      aspects:evidenceAspects('where is the rule'),limit:2,maxTokens:4000,candidates:32,timeoutMs:5000,recovery:true,
      expand:async rows=>({results:rows,truncated:false}),
    },{apiKey:'test',cache:false,fetch:fetcher})
    expect(calls).toBe(1)
    expect(result.evidence.verdict).not.toBe('direct-evidence')
  })
  it('preserves the actual local packet on provider rejection, not the reordered discovery candidates',async()=>{
    const local=source('local'),semantic={...source('semantic'),semanticScore:.99}
    const result=await evaluateImplementationContext('where is the rule',[semantic,local],{
      aspects:evidenceAspects('where is the rule'),limit:2,maxTokens:4000,candidates:32,timeoutMs:5000,recovery:true,localResults:[local],
      expand:async rows=>({results:rows,truncated:false}),
    },{apiKey:'test',cache:false,fetch:async()=>new Response('{}',{status:403})})
    expect(result.results.map(evidenceKey)).toEqual([evidenceKey(local)])
    expect(result.evidence.verdict).not.toBe('direct-evidence')
  })
  it('cannot admit an out-of-scope package through high evidence or contribution scores',async()=>{
    const fetcher:typeof fetch=async(_url,init)=>{
      const body=JSON.parse(init!.body as string)
      const answers=Object.fromEntries(Object.entries(body.questions).map(([id,raw])=>{
        const q=raw as any,candidate=body.state.candidates[id.split('_')[0]]
        if(q.type==='noul') return [id,{type:'noul',noul:/contradiction|asserted_premise/.test(id)?0:id.endsWith('_relevant')&&candidate.symbol==='unrelated'?.1:.95}]
        const keys=Object.keys(q.criteria),choice=keys.includes('supports')?'supports':keys.find(k=>k.endsWith('_whole'))??(keys.includes('none')?'none':keys[0])
        return [id,{type:'choice',choice,confidence:1,probabilities:Object.fromEntries(keys.map(k=>[k,k===choice?1:0]))}]
      }))
      return Response.json({answers})
    }
    const result=await evaluateImplementationContext('status parsing',[source('unrelated'),source('actual')],{
      aspects:evidenceAspects('status parsing'),limit:5,maxTokens:4000,candidates:32,timeoutMs:5000,recovery:true,
      expand:async rows=>({results:rows,truncated:false}),
    },{apiKey:'test',cache:false,fetch:fetcher})
    expect(result.results.map(r=>r.metadata.symbolName)).toEqual(['actual'])
    expect(result.jev.diagnostics.packages?.rejected).toContainEqual({root:evidenceKey(source('unrelated')),reason:'incompatible-scope'})
  })
  it('runs package ranking and final joint verification without discarding equal-score complements',async()=>{
    const fetcher:typeof fetch=async(_url,init)=>{
      const body=JSON.parse(init!.body as string)
      const answers=Object.fromEntries(Object.entries(body.questions).map(([id,raw])=>{
        const q=raw as any
        if(q.type==='noul') return [id,{type:'noul',noul:/contradiction|asserted_premise/.test(id)?0:.95}]
        const choices=Object.keys(q.criteria),choice=choices.includes('supports')?'supports':choices.find(k=>k.endsWith('_whole'))??(choices.includes('none')?'none':choices[0])
        return [id,{type:'choice',choice,confidence:1,probabilities:Object.fromEntries(choices.map(k=>[k,k===choice?1:0]))}]
      }))
      return Response.json({answers,usage:{input_tokens:100,output_tokens:50,cost:.00001}})
    }
    const sources=[source('encrypt'),source('decrypt')]
    const result=await evaluateImplementationContext('encrypt and decrypt',sources,{
      aspects:evidenceAspects('encrypt and decrypt'),limit:2,maxTokens:4000,candidates:32,timeoutMs:5000,recovery:true,
      expand:async rows=>({results:rows,truncated:false}),
    },{apiKey:'test',cache:false,fetch:fetcher})
    expect(result.results.map(evidenceKey)).toEqual(sources.map(evidenceKey))
    expect(result.evidence.verdict).toBe('direct-evidence')
    expect(result.evidence.partitions).toBe(1)
  })
})
