import {evaluateWithJev} from '../packages/core/dist/tool/jev.js'
import {readFileSync,writeFileSync} from 'node:fs'
const samples=[
 'A simulacao de envio SMS exige token e ainda envia uma requisicao ao provedor?',
 'O dry-run exige token. Onde isso e validado?',
 'Does dry-run contact the provider?',
 'Dry-run always contacts the provider. Show the implementation.',
 'Why does dry-run contact the provider?',
 'Como os status de entrega do provedor de SMS sao traduzidos, inclusive um status desconhecido?',
 'Quando a idade do saldo permite ignorar o minimo de repasse? O limite e inclusivo?',
 'O saldo so e liberado depois de 30 dias, nunca no trigesimo dia. Confirme.',
]
const questions={asserted_premise:{type:'noul',instructions:'Considering ONLY state.query, does the user assert or presuppose a factual claim about the code behavior as already true? A yes/no question such as "Does dry-run send a request?" does NOT assert that it sends one. A request to explain a rule or find code does NOT assert an answer. "Dry-run sends requests; show where" asserts a fact. "Why does X happen?" presupposes X. Do not use candidate source to decide this linguistic question.',criteria:{true:'Query includes a declarative factual claim or presupposes an outcome that supplied code could refute.',false:'Query asks whether/how/where/which behavior occurs without asserting its answer; a concrete negative answer would still answer the question.'}}}
const rows=[]
for(const query of samples){const result=await evaluateWithJev(query,[{file:'query',startLine:1,endLine:1,content:'',metadata:{},semanticScore:0}],{mode:'evidence',featureQuestions:questions,candidates:1,timeoutMs:5000});rows.push({query,status:result.diagnostics.status,score:[...result.scores.values()][0]?.dimensions?.asserted_premise,cost:result.diagnostics.cost});console.log(JSON.stringify(rows.at(-1)))}
writeFileSync('docs/evaluations/jev-v9.1-minimal-2026-09-25/query-premise-probe.json',JSON.stringify(rows,null,2)+'\n')
