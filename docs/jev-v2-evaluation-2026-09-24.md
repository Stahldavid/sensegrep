# Jev v2: implementação e validação — 24/09/2026

Implementação local na branch `works/jev-evidence`. Sem publicação npm nem alteração do CLI global nesta etapa. A integração permanece opcional.

## Alterações

- Lotes de cinco candidatos por padrão, configuráveis de 1 a 10, quatro requisições concorrentes, orçamento de bytes e divisão de lotes grandes.
- `Score` com quatro níveis, Nouls separados de relevância/evidência/contradição, papel do trecho e distribuições preservadas. Saída gratuita do Jev não é tratada como entrada gratuita.
- Estratégias `score`, `legacy` e `rrf` disponíveis no CLI/MCP. `score` permanece como padrão; RRF é experimental.
- Avaliação do pacote estruturado final, após diversidade e seleção por tokens, com hash e classificação de evidência. Pacotes grandes são particionados em limites de fonte; falha ou truncamento de uma parte impede uma avaliação completa.
- Avaliação adicional de contribuição para até seis candidatos de contexto. Orçamento determinístico, código original e padrão existente de 12.000 tokens preservados.
- Expansão por chamadas locais/imports relativos sem exigir coincidência literal da consulta; candidatos novos só entram após avaliação própria e não substituem resultados locais antes disso.
- Cache vinculado ao estado completo e à ordem do lote, incluindo o contexto selecionado. Armazena decisões numéricas, sem fonte, chave, consulta ou legendas do provedor.
- Diagnósticos opcionais são retirados antes de código quando a saída é pequena. Cortar código invalida a avaliação do pacote.
- Duplicatas: pré-condições, autorização, efeitos, erros e mapeamentos separados. Comparação adicional de literais/operadores no AST bloqueia classificação de mesma regra quando existe diferença ou parsing indisponível. A fonte original do índice é preferida ao texto enriquecido para embeddings.

Documentação operacional: [jev.md](jev.md).

## Comparação principal: 49 casos

Mesmo snapshot congelado do CuraAI: 940 arquivos, 6.513 chunks, Ollama `qwen3-embedding:0.6b`, 1.024 dimensões. Modelo remoto resolvido: `typesafe/jev-1.13-20260917`.

Baseline: implementação Jev anterior a estas alterações, preservada antes da edição. Candidato: lotes, Score, seleção de contribuição, expansão corrigida e prioridade de fonte no orçamento. Ordem de execução alternada, cache Jev desligado e verificação estrita do snapshot antes/depois.

| Métrica | Jev anterior | Candidato |
| --- | ---: | ---: |
| Arquivo esperado no top 5 | 30/32 | 30/32 |
| Arquivo esperado no top 10 | 32/32 | 32/32 |
| Símbolo esperado no top 5 | 14/15 | 14/15 |
| MRR por arquivo | 0,7669 | 0,7721 |
| Helper esperado no contexto | 11/11 | 11/11 |
| Falso alerta de evidência fraca nas buscas positivas | 0/32 | 0/32 |
| Requisições Jev | 980 | 268 |
| Mediana observada da busca completa | 5.313 ms | 4.742 ms |
| P95 observado | 11.190 ms | 6.044 ms |
| Custo reportado pelo provedor | US$ 0,056172 | US$ 0,076876 |

A cobertura foi preservada, não aumentada. A quantidade de chamadas caiu cerca de 73%, mas o custo de entrada subiu cerca de US$ 0,021 nesta rodada devido às novas verificações de contexto. A latência inclui inicialização do CLI, retrieval local e rede; não é garantia de desempenho do provedor. Atividade local durante a validação também pode afetar os tempos.

Esta rodada ainda usava um único pacote final limitado: detectou 4/6 negativos, contra 5/6 no baseline. Não escondemos essa regressão. Ela motivou o particionamento descrito abaixo.

Dados numéricos: [comparison-49.json](evaluations/jev-v2-2026-09-24/comparison-49.json).

## Regressão final: 17 casos após particionamento

Reexecutados os seis negativos e todos os 11 contextos, nos mesmos dados, após corrigir pacotes grandes e distinguir incerteza de evidência parcial. Não houve ajuste de threshold para um nome de tecnologia ou uma consulta específica.

- Negativos sinalizados: **6/6**, baseline **5/6**.
- Helpers no contexto: **11/11**, inclusive orçamentos de 1.200, 4.000 e 8.000 tokens.
- Requisições: **108**, baseline **340**.
- Custo: **US$ 0,027717**, baseline **US$ 0,019264**.
- Snapshot e limites físicos de saída verificados.

Não somar esta rodada à tabela anterior como se fossem consultas independentes. A tabela principal registra a rodada executada antes do particionamento; os números de custo/latência da implementação final completa não foram extrapolados a partir destes 17 casos.

Dados: [packet-regressions-17.json](evaluations/jev-v2-2026-09-24/packet-regressions-17.json).

## Suíte sintética independente da recuperação

Nove consultas novas sobre autorização de faturas, ordenação de eventos, retenção, constante, comentário com instrução adversarial e duas consultas sem resposta próximas ao domínio. Quatro configurações por consulta: lotes 1, 5, 10 e lote 5 com ordem invertida. Total: **36 execuções de ranking**.

- `Score`: símbolo esperado em primeiro nos **28 cenários positivos**.
- Os dois negativos receberam `no-evidence-found` na verificação de pacote.
- O comentário adversarial não deslocou o símbolo esperado nestes casos.
- Mediana da etapa Jev com ordem normal: **725 ms** para lote 1, **328 ms** para lote 5, **329 ms** para lote 10.
- Requisições de ranking nas nove consultas com ordem normal: **73**, **18**, **9**, respectivamente.
- Custo total reportado da suíte, incluindo os dois pacotes negativos: **US$ 0,009262**.

Não é um benchmark de embeddings nem de retrieval de repositório. A inversão da ordem também altera o prior local usado por RRF; não se deve interpretar o resultado de RRF como medida pura de viés posicional do modelo. A amostra favorece manter Score como padrão simples e RRF disponível para experimentos, sem alegar superioridade universal.

Dados: [synthetic-decisions-36.json](evaluations/jev-v2-2026-09-24/synthetic-decisions-36.json). Runner: [evaluate-jev-decisions.mjs](../scripts/evaluate-jev-decisions.mjs).

## Verificações de integração

- Build, typecheck e consistência de versões passaram.
- Suíte completa: **297 testes em 48 arquivos**, incluindo AST de literais/operadores, lotes, cache, respostas inválidas, timeout, partição incompleta, contribuição e orçamento de saída.
- MCP real: parâmetros novos anunciados no schema; consulta com Jev completou em três chamadas, dentro do orçamento solicitado.
- Duplicatas reais de `paymentProvider.ts`: estrutura semelhante, regras/mapeamentos diferentes; classificação de comportamento diferente, dimensões preservadas e `literalOperatorDifference: true` confirmado no AST. Foi corrigido o uso de texto enriquecido para embeddings nessa evidência, preferindo `contentRaw` do índice.
- Survey real: classificação de pagamentos, distribuições de domínio e papel preservadas.
- Timeout real de 100 ms: fallback observado em aproximadamente 115 ms, IDs/ordem iguais ao modo local e filtro de arquivo preservado.
- Sem chave: zero requisições, mesmos resultados locais. Busca exata: Jev ignorado.

Dados do fallback: [fallback-smoke.json](evaluations/jev-v2-2026-09-24/fallback-smoke.json).

## Limitações que permanecem

As probabilidades e thresholds continuam não calibrados para código. Seis negativos reais e dois sintéticos não bastam para estimar uma taxa geral de erro. A expansão de helpers é limitada a um salto em JS/TS e relações resolvidas; não é um grafo completo. A contribuição é avaliada contra uma âncora fixa, não contra todas as combinações de contexto. O guard de literais/operadores não prova equivalência e retorna indisponível para linguagens não suportadas ou fontes parciais.

O custo de saída zero permite preservar avaliações úteis, mas passes adicionais sobre fonte continuam aumentando o custo de entrada. A integração permanece opt-in e mantém fallback local.
