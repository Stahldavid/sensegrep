export function factSourceMetrics(row,bindings) {
  const facts=Object.entries(bindings[row.id]??{}).map(([id,refs])=>({id,
    supported:refs.length>0 && refs.every(ref=>row.references?.some(r=>r.file===ref.file && r.symbol===ref.symbol && r.present))}))
  return {facts,factSourceCoverage:facts.length?facts.filter(f=>f.supported).length/facts.length:null,
    allFactSources:row.answerExistsInScope && facts.length>0 && facts.every(f=>f.supported)}
}
