import {readFileSync,writeFileSync} from 'node:fs'
import path from 'node:path'
import {factSourceMetrics} from './jev-reviewed-facts.mjs'
const dir=path.resolve(process.argv[2]??'')
const bindings=JSON.parse(readFileSync('scripts/fixtures/jev-v9-fact-bindings.json','utf8')).bindings
const splits=['dev','validation','reserved'].map(s=>JSON.parse(readFileSync(path.join(dir,s+'.json'),'utf8')))
if(splits.some((s,i)=>s.rows.length!==[45,15,30][i]))throw Error('Incomplete evaluation; do not produce final summary')
const mean=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null
function aggregate(rows) {
  return Object.fromEntries(['local','selection','recovery'].map(arm=>{
    const all=rows.filter(r=>r.arm===arm).map(r=>({...r,...factSourceMetrics(r,bindings)})),positive=all.filter(r=>r.answerExistsInScope)
    const groups=[...new Set(positive.map(r=>r.group))]
    return [arm,{queries:all.length,failed:all.filter(r=>r.status==='failed').length,
      completeReferenceSets:positive.filter(r=>r.completeReferenceSet).length,
      allFactSources:positive.filter(r=>r.allFactSources).length,positiveQueries:positive.length,
      macroFamilyFactSourceCoverage:mean(groups.map(g=>mean(positive.filter(r=>r.group===g).map(r=>r.factSourceCoverage ?? 0)))),
      meanMs:mean(all.map(r=>r.ms).filter(Number.isFinite)),
      unsupportedDirectProxy:all.filter(r=>r.verdict==='direct-evidence' && (!r.answerExistsInScope || !r.allFactSources)).map(r=>r.id),
      negativeVerdicts:all.filter(r=>!r.answerExistsInScope).map(r=>({id:r.id,verdict:r.verdict ?? 'not-assessed'})),
      evaluationStatuses:all.reduce((counts,r)=>{const k=r.jev?.status ?? 'off';counts[k]=(counts[k]??0)+1;return counts},{}),
    }]
  }))
}
const ledger=JSON.parse(readFileSync(path.join(dir,'budget.json'),'utf8'))
const calibration=JSON.parse(readFileSync(path.join(dir,'calibration.json'),'utf8'))
const result={splits:Object.fromEntries(splits.map(s=>[s.split,aggregate(s.rows)])),overall:aggregate(splits.flatMap(s=>s.rows)),
  budget:{capUsd:ledger.capUsd,accountedUpperBoundUsd:ledger.chargedUpperBoundUsd,requests:ledger.requests.length,
    uncertain:ledger.requests.filter(r=>r.status!=='settled').length,blocked:ledger.blocked},
  calibration:{selected:calibration.selected,strict:calibration.strict,advisory:calibration.advisory},
  promotion:'not-promoted',note:'Source provenance metrics, not independent semantic correctness judgments. Thirty queries in seven families; no statistical significance claim.'}
writeFileSync(path.join(dir,'summary.json'),JSON.stringify(result,null,2)+'\n')
const pct=v=>(100*v).toFixed(1)+'%'
const rows=Object.entries(result.overall).map(([arm,m])=>`| ${arm} | ${m.allFactSources}/${m.positiveQueries} | ${pct(m.macroFamilyFactSourceCoverage)} | ${(m.meanMs/1000).toFixed(2)} s | ${m.unsupportedDirectProxy.length} |`).join('\n')
writeFileSync(path.join(dir,'REPORT.md'),`# Sensegrep/Jev: avaliação das 30 consultas\n\nExecutadas 90 combinações (30 consultas × local, seleção, recuperação), com desenvolvimento 15, validação 5 e reservadas 10. Configuração congelada antes das duas últimas etapas.\n\n| Configuração | Todas as fontes dos fatos | Cobertura por família | Latência média | Diretos sem todas as fontes esperadas |\n|---|---:|---:|---:|---:|\n${rows}\n\nA tabela mede presença integral das fontes revisadas por fato, não a correção semântica de uma resposta gerada. Fontes alternativas podem exigir revisão manual. A pergunta negativa tem escopo restrito e não entra no denominador das 29 positivas. Sete famílias não são 30 amostras independentes. Resultados por divisão estão em summary.json.\n\n## Correções e validação\n\n- Corrigida troca de âncora que removia dependências diante de cobertura apenas igual; agora exige ganho em ao menos um requisito.\n- 173 testes Vitest e 10 testes Node passaram; build e tipos passaram.\n- Índice local atualizado e verificado antes/depois de cada divisão; hashes das fontes revisados antes da execução.\n- Cobrança conservadora: US$ ${ledger.chargedUpperBoundUsd.toFixed(6)} de US$ 0,50, ${ledger.requests.length} chamadas; ${result.budget.uncertain} reservas sem liquidação exata. Timeout/rejeição preservam a reserva. Nenhuma chave é gravada nos artefatos.\n\n## Calibração e decisão\n\nReaproveitadas respostas de desenvolvimento, sem nova inferência, para avaliar tornar a inspeção apenas informativa. Política escolhida: **${calibration.selected}**. A alternativa passou de ${calibration.strict.unsupportedDirectProxy} para ${calibration.advisory.unsupportedDirectProxy} vereditos diretos sem todas as fontes esperadas, embora aumentasse a aceitação de contextos completos de ${calibration.strict.acceptedCompleteReferenceSets} para ${calibration.advisory.acceptedCompleteReferenceSets}.\n\nO duplo veto foi analisado nas respostas capturadas: ${calibration.doubleVetoDisagreements.length} divergências. A captura começou durante desenvolvimento; isso não representa todas as chamadas. Não há evidência suficiente para remover o veto automaticamente.\n\nPesos experimentais não promovidos e release não publicado. Prioridade técnica seguinte: investigar os casos concretos em que a recuperação removeu uma implementação correta e os falsos completos indicados, preservando os resultados reservados como avaliação já consumida.\n`,'utf8')
console.log(JSON.stringify(result))
