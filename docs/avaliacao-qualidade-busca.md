# Avaliação das correções de busca e contexto

Data: 24/09/2026. Baseline: CLI global 1.17.2. Candidato: build local com as alterações de qualidade, ainda sem publicação. Nenhuma integração Jev foi adicionada.

## Ambiente e método

O índice original do CuraAI estava desatualizado. A comparação final usa uma cópia isolada dos arquivos atuais, incluindo código ainda não rastreado pelo Git, e um índice incremental atualizado apenas nessa cópia: **940 arquivos, 6.513 chunks**, verificação estrita sem alterações, ausências ou remoções pendentes. O índice do projeto original foi preservado.

Modelo: Ollama `qwen3-embedding:0.6b`, 1.024 dimensões. Ambas as CLIs consultaram a mesma snapshot: `chunks_1790256700685_d9b6a21f8dfd4e0a907b5ffcba9c11fb:1790256707429`.

Conjunto principal: 28 perguntas positivas (22 históricas e seis controles/perguntas adicionais), quatro negativas e nove contextos. Onze perguntas positivas têm alvos explícitos por símbolo; as demais preservam os alvos históricos por arquivo. Contextos cobrem saldo mínimo, autenticação e voz com 1.200, 4.000 e 8.000 tokens.

A execução alternou a ordem das CLIs. As 28 buscas positivas do candidato confirmaram cache de embedding aquecido nos diagnósticos. Tempos abaixo são de processo completo, não apenas da busca vetorial. São medições de uma passagem, não intervalos estatísticos de confiança. Os resultados medem as alterações combinadas; não isolam causalmente o ganho de cada heurística.

## Resultado principal

| Métrica | 1.17.2 | Candidato |
|---|---:|---:|
| Arquivo esperado no top 5 | 26/28 | 26/28 |
| Arquivo esperado no top 10 | 27/28 | 28/28 |
| Símbolo esperado no top 5 | 8/11 | 10/11 |
| Símbolo esperado no top 10 | 8/11 | 11/11 |
| Símbolo central presente nos nove contextos | 6/9 | 9/9 |
| Consultas negativas com aviso de evidência fraca | 0/4 | 3/4 |
| Avisos indevidos nas 28 perguntas positivas | 0 | 0 |
| Latência mediana | 2.536 ms | 2.828 ms |
| Latência p95 | 3.415 ms | 3.615 ms |

O custo mediano adicional foi de 292 ms (aproximadamente 11,5%). A expansão não faz novas chamadas de embedding.

## Casos que motivaram a mudança

- **Saldo mínimo em inglês:** `shouldIgnoreMinimumPayout` saiu de ausente no top 10 para primeiro lugar. Também passou a ser o primeiro trecho nos três orçamentos de contexto.
- **Saldo mínimo em português:** a função saiu de ausente no top 10 para quarto lugar. A preferência por implementação preserva a relevância do arquivo, evitando que telas com mais palavras correspondentes desloquem o módulo de regras.
- **Constante como alvo:** `MAX_SMALL_BALANCE_AGE_MS` permaneceu em primeiro na pergunta explícita sobre seu valor.
- **Criptografia ampla:** `encryptPayoutDestination` saiu de ausente no top 10 para nono lugar. A recuperação melhorou; esse caso ainda não alcança o top 5. Não há alegação de recuperação perfeita.
- **Contexto de criptografia:** nos testes adicionais de 4.000 e 8.000 tokens, ambos os helpers (`encryptPayoutDestination` e `decryptPayoutDestination`) aparecem com código. O helper de criptografia, antes omitido em ambos os orçamentos, passou a ser o quinto trecho.
- **Autenticação e voz:** os helpers centrais continuaram nos contextos pequenos; os nove contextos do conjunto principal passaram a colocar o alvo em primeiro lugar.
- **Kubernetes/Kafka/EKS:** passou a receber aviso de evidência fraca. A consulta sobre Terraform/Neptune continuou `not-assessed`: termos genéricos compartilhados ainda podem impedir o aviso conservador. `not-assessed` não afirma suficiência.

## Decisão sobre tokens

O padrão de `context`/`audit` já era **12.000 tokens** e foi mantido. Os 1.200 tokens eram um teste de estresse. Para uso com orçamento explícito, 4.000 é uma opção compacta e 8.000 acomoda investigação entre arquivos. A seleção foi corrigida também sob 1.200, sem depender apenas de aumentar o teto.

## Validação automatizada e reprodução

- Build e typecheck de todos os workspaces: aprovados.
- Vitest: **266 testes aprovados, em 46 arquivos**.
- Consistência de versões: aprovada; a versão publicada não foi alterada.
- Testes novos cobrem diversidade, constantes, implementação, limites de tokens, projeção JSON, português, imports com alias, escopo de arquivos, ambiguidade, cancelamento, timeout de banco e fontes desatualizadas.

Dados principais: [CSV por caso](benchmarks/search-quality-2026-09-24.csv) e [totais JSON](benchmarks/search-quality-2026-09-24.json).

A saída com conteúdo de código foi validada separadamente: **11/11 contextos contêm o símbolo esperado**, contra 6/11 no baseline, e todos respeitam os limites de tokens e bytes. O CSV reúne 28 buscas positivas, quatro negativas e esses 11 contextos (43 casos distintos). Os totais JSON resumem apenas as buscas. Os ajustes finais da seleção de contexto não alteram o caminho de busca sem orçamento usado na medição de latência principal.

Casos e executor: `scripts/fixtures/search-quality-curaai.json`, `scripts/fixtures/search-quality-context-curaai.json` e `scripts/evaluate-search-quality.mjs`. O segundo manifesto inclui conteúdo de código no JSON e dois contextos adicionais de criptografia. Veja comandos e limitações em [search-quality.md](search-quality.md).

O indicador de evidência permanece heurístico, sem calibração probabilística. A avaliação usa um repositório e um modelo de embeddings; não comprova generalização para todos os idiomas, modelos ou bases de código. A expansão estrutural é limitada a um salto em chamadas locais JS/TS, e não substitui um grafo completo ou análise de tipos.

## Controle sem cache

Três perguntas foram repetidas com cache de embedding desativado, confirmando uma requisição ao Ollama por busca. Tempos baseline/candidato: criptografia 5.736/3.145 ms; saldo mínimo 3.804/3.966 ms; Clerk 3.352/3.384 ms. Essa amostra pequena e variável não sustenta uma alegação de aceleração; a comparação principal com cache aquecido é mais adequada para observar o custo da seleção e expansão.
