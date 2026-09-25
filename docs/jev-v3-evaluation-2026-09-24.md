# Jev v3: implementação e avaliação

Implementado na branch `works/jev-coverage`, sobre Sensegrep 1.18.0. Jev continua opcional. A infraestrutura de calibração foi implementada, mas nenhum ranking aprendido foi ativado sem rótulos independentes suficientes.

## Implementação, na ordem do plano

1. **Rastreabilidade:** identidade, origem e sinais dos candidatos antes da deduplicação, após deduplicação, avaliados pelo Jev, diversificados e selecionados. Diagnóstico omitido antes do código quando a saída tem limite de bytes.
2. **Rubrica:** helper que implementa a exceção solicitada pode receber relevância máxima. Constantes têm relevância máxima quando respondem ao valor solicitado. Operação, condição, configuração, dependência e contradição são julgamentos distintos.
3. **Evidência estrutural:** helpers carregam chamada e trecho do chamador, com resolução estática de import relativo ou mesmo arquivo. Hashes do chamador e do destino são verificados. Contexto adicional de constantes literais está disponível, experimentalmente, com `--jev-bundles`; não executa expressões nem resolve dependências arbitrárias.
4. **Conjunto de candidatos:** até 80, preservando representação lexical/vetorial e reservando até quatro posições para helpers, inclusive os já encontrados localmente. Uma única recuperação adicional pode oferecer até quatro helpers descobertos por chamadas reais. Padrão mantido em 20 após comparação de custo/qualidade.
5. **Cobertura:** substituída a pergunta contra o primeiro resultado por uma matriz de aspectos. A seleção recalcula o ganho marginal contra todo o conjunto selecionado. Requisitos vêm de cláusulas literais da pergunta ou `--jev-aspects`, nunca de texto gerado pelo Jev.
6. **Blocos AST:** `--jev-blocks` seleciona instruções inteiras de funções grandes. Mantém cabeçalho e blocos de guarda/retorno/try; informa linhas e omissões e sempre marca a função como incompleta. Permanece experimental.
7. **Scores:** sinais local/modelo e peso de mistura separados. Concentração da distribuição limita influência, sem ser tratada como probabilidade de acerto. Score, RRF e estratégia legada continuam comparáveis; cache de alias reduzido para 15 minutos.
8. **Pacote final:** avaliação por aspecto com partições e requisitos ausentes. Evidências distribuídas entre partições não recebem veredito de implementação completa. Falhas, truncamentos e orçamento insuficiente mantêm avaliação inconclusiva.
9. **Calibração offline:** exportador sem rótulos automáticos; regressão logística local versus seleção de características com validação cruzada por grupo; teste separado; comparação opcional com CatBoost instalado. Perguntas e decisões fornecem atributos distintos, incluindo média/dispersão do Score. Saída sempre `deploy: false`.
10. **Avaliação:** matriz de quatro variantes, dois repositórios, índices congelados, consultas PT/EN, top 5 por símbolo, presença no contexto, consultas negativas, custo e latência. Intervalos pareados agrupam paráfrases de uma regra.

## Resultados reais

Foram executadas **100 consultas de CLI** na matriz final: 25 casos × quatro variantes. A versão publicada global foi preservada como baseline. As chamadas usaram `typesafe/jev-1.13-20260917`, com cache Jev desligado e embeddings locais Ollama `qwen3-embedding:0.6b`.

| Critérios atendidos | Local publicado | Local novo | Jev publicado | Jev novo |
|---|---:|---:|---:|---:|
| CuraAI, 16 casos de regressão | 14/16 | 14/16 | 15/16 | **16/16** |
| Sensegrep, 9 perguntas novas | 8/9 | 8/9 | 8/9 | 8/9 |
| Total | 22/25 | 22/25 | 23/25 | **24/25** |

Critério positivo: símbolo esperado no top 5; em contexto, presença no pacote retornado. A consulta de criptografia exige os dois símbolos, `encryptPayoutDestination` e `decryptPayoutDestination`. Critério negativo: aviso `weak-evidence`. Os rótulos de autenticação foram refinados de arquivo para símbolo e os de criptografia para o par de helpers usando as saídas já retidas; isso não alterou os totais. A inclusão de símbolos não equivale a uma resposta final semanticamente correta.

**Ganho concreto:** na busca ampla por criptografia, os helpers apareciam na recuperação, mas ficavam fora do conjunto avaliado. Na matriz nova, descriptografia ficou em primeiro e criptografia em quinto; o Jev publicado retornou apenas criptografia, em oitavo. A reserva de helpers e a cobertura corrigiram essa perda.

O caso ainda não resolvido nas quatro variantes foi a pergunta em português sobre distinguir embeddings de outro endpoint/dimensão no próprio Sensegrep. Foi mantido como falha de avaliação, sem ajustar a implementação para essa pergunta nova.

Nenhuma das quatro consultas negativas da matriz recebeu `direct-evidence` com Jev. Isso é uma amostra pequena, não uma taxa de segurança estimada.

| Medida | Jev publicado | Jev novo |
|---|---:|---:|
| Mediana CuraAI | 5.499 ms | 4.586 ms |
| Mediana Sensegrep | 3.329 ms | 3.236 ms |
| Requisições nos 25 casos | 139 | 128 |
| Custo informado pelo provedor | US$ 0,039388 | US$ 0,044878 |

Menos requisições não significou menor custo: as perguntas atômicas adicionais aumentaram os tokens de entrada. Tokens de saída gratuitos não eliminam esse custo. As duas matrizes tiveram execução parcialmente concorrente no computador; latências são observações dessa execução, não um benchmark isolado de velocidade.

No CuraAI, o intervalo bootstrap pareado por grupo para o ganho versus Jev publicado foi **0 a 23,08 pontos percentuais**; versus local novo, **0 a 33,33 pontos**. Ambos incluem zero. Portanto, há um ganho demonstrado no caso de criptografia, mas ainda não há base para afirmar melhoria generalizada ou ativar Jev por padrão.

## Candidatos e ranking

Uma comparação adicional executou 18 buscas: três consultas × limites 20/40/80 × Score/RRF. Nos dois casos positivos, aumentar o limite não acrescentou acertos no top 5. Em criptografia, Score colocou o helper de criptografia em segundo nos três limites; RRF o colocou em quinto, quinto e quarto. O custo Score subiu de US$ 0,001427 para US$ 0,006020 nessa consulta. Em saldo mínimo, o helper ficou em primeiro em todas as variantes.

Decisão: **20 candidatos e Score continuam os padrões**. 40/80 e RRF permanecem opções de experimento. A consulta negativa desse sweep teve apenas diagnóstico de custo/status registrado pelo script daquela execução; sua qualidade é avaliada na matriz principal, não inferida de `symbolRank: 0`.

## Validação técnica e limites

- `npm test`: **304 testes**, 49 arquivos, passaram.
- Typecheck de todos os workspaces passou; consistência de versões e verificação dos três pacotes de release passaram.
- Três testes Python validaram seleção de característica, isolamento dos rótulos de teste e rejeição de vazamento entre grupos.
- Dois testes Node validaram o bootstrap pareado e a contabilização de falsa suficiência.
- Smoke real das opções experimentais: extração AST de fonte sintética de 7.050 caracteres produziu 269 caracteres, mantendo guarda e retorno e marcando o trecho incompleto. A inclusão de uma constante literal também completou a chamada Jev. Custo combinado: US$ 0,00018648.
- CatBoost é uma integração opcional; não foi instalado nem executado nesta validação. Não há ganho de ranking aprendido demonstrado ou ativado.
- Não houve benchmark de agente executando tarefas completas; não foi demonstrada economia de tokens de agentes.
- O contexto padrão permanece em 12.000 tokens; 1.200 é teste de estresse. Também foram exercitados contextos de 4.000.

Os diagnósticos ajudaram a identificar e corrigir duas regressões durante o desenvolvimento: helpers encontrados mas não avaliados, e o trace ocupando o orçamento destinado ao código. Os resultados acima são da execução posterior a essas correções. Ajustes finais das opções experimentais foram validados por testes e smoke próprios; essas opções estavam desligadas na matriz.

## Artefatos

- [Matriz CuraAI](evaluations/jev-v3-2026-09-24/curaai.json)
- [Matriz Sensegrep](evaluations/jev-v3-2026-09-24/sensegrep.json)
- [Comparação 20/40/80 e Score/RRF](evaluations/jev-v3-2026-09-24/candidate-ranking-ablation.json)
- [Uso e reprodução](jev.md)

Fixtures: `scripts/fixtures/jev-matrix-curaai.json` e `scripts/fixtures/jev-matrix-sensegrep.json`. Os artefatos compactos incluem snapshots, símbolos retornados, modelos, custos e estágios de perda, sem código-fonte ou credenciais.
