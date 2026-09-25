// Source-reviewed alternatives, never model-generated grades. A symbol hit and
// evidence of a fact are separate measurements; neither claims agent accuracy.
export function matchesSource(row, expected) {
  if (expected.anyOf) return expected.anyOf.some(e=>matchesSource(row,e))
  const file=String(row.file??'').replaceAll('\\','/')
  return file===expected.file && (!expected.symbol || (row.symbol??row.symbolName??row.metadata?.symbolName)===expected.symbol)
}
export function factMetrics(facts, results) {
  const complete=r=>!r.contentTruncated && !r.diagnostic?.contentTruncated
  const evidence=(facts??[]).map(fact=>({id:fact.id, sources:results.filter(r=>complete(r) && fact.anyOf.some(e=>
    matchesSource(r,e) && e.includes.every(text=>typeof r.content==='string' && r.content.includes(text))))
    .map(r=>({file:r.file,symbol:r.symbol??r.metadata?.symbolName}))}))
  return {factCoverage:evidence.length?evidence.filter(f=>f.sources.length).length/evidence.length:null,
    allFacts:evidence.length?evidence.every(f=>f.sources.length>0):null,factEvidence:evidence}
}
