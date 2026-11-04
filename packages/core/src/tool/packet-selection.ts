import { sameSource, conflictingSource, type SourceSpan } from "./source-identity.js"
export type SourcePackage<R extends SourceSpan> = {root:R;sources:R[];candidate:R;bounded:boolean}
const sourceKey=(r:SourceSpan & {metadata:Record<string,unknown>})=>`${r.file}:${r.startLine}:${r.endLine}:${r.metadata.symbolName??''}`

export function selectSourcePackages<R extends SourceSpan & {metadata:Record<string, unknown>}>(packages:SourcePackage<R>[], limit:number,maxTokens:number,
  tokens:(r:R)=>number,
  limits:{maxPerFile?:number;maxPerSymbol?:number}={}) {
  const results:R[]=[],selected:SourcePackage<R>[]=[],rejected:Array<{root:string;reason:string}>=[]
  let estimatedTokens=0
  for(const packet of packages) {
    const additions=packet.sources.filter((r,index)=>![...results,...packet.sources.slice(0,index)].some(s=>sameSource(s,r)))
    const cost=additions.reduce((n,r)=>n+tokens(r),0)
    const combined=[...results,...additions]
    const fileCounts=new Map<string,number>(),symbolCounts=new Map<string,number>()
    for(const row of combined) {
      fileCounts.set(row.file,(fileCounts.get(row.file)??0)+1)
      const symbol=`${row.file}:${String(row.metadata.symbolName??row.startLine)}`
      symbolCounts.set(symbol,(symbolCounts.get(symbol)??0)+1)
    }
    const conflict=packet.sources.some((row,index)=>[...results,...packet.sources.slice(0,index)].some(previous=>conflictingSource(previous,row)))
    const fileLimit=!!limits.maxPerFile && [...fileCounts.values()].some(count=>count>limits.maxPerFile!)
    const symbolLimit=!!limits.maxPerSymbol && [...symbolCounts.values()].some(count=>count>limits.maxPerSymbol!)
    const reason=conflict?'source-conflict':fileLimit?'max-per-file':symbolLimit?'max-per-symbol':!additions.length?'covered-source':selected.length>=limit?'package-limit'
      :results.length+additions.length>40?'source-limit':estimatedTokens+cost>maxTokens?'token-budget':undefined
    if(reason) {rejected.push({root:sourceKey(packet.root),reason});continue}
    // Atomic admission: never emit the parent while silently dropping its bundle.
    results.push(...additions);selected.push(packet);estimatedTokens+=cost
  }
  return {results,selected,rejected,estimatedTokens}
}
