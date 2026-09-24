# Plano de melhoria da busca e seleção de contexto

Status: implementado localmente; validação e resultados registrados em [avaliacao-qualidade-busca.md](avaliacao-qualidade-busca.md). Publicação não executada nesta etapa.

Decisão de orçamento: `context` já tinha padrão de **12.000 tokens**, que foi mantido. 1.200 era o orçamento de estresse dos testes; a avaliação também cobre 4.000 e 8.000 tokens. A política final está em [search-quality.md](search-quality.md).

Base: avaliação prática do Sensegrep 1.17.2 em 24/09/2026, com Ollama `qwen3-embedding:0.6b` no CuraAI. Foram feitas 22 perguntas: arquivo esperado no top 5 em 20 casos e no top 10 em 21. A mediana de busca foi 2,46 s. Esses números medem localização de arquivos, não suficiência das respostas.

## Objetivo

Recuperar as funções que implementam a regra perguntada e incluí-las no contexto disponível. Preservar diversidade, limites de saída e latência, sem tratar similaridade como garantia de resposta correta.

## 1. Diversidade flexível por arquivo — prioridade alta

**Problema observado:** a pergunta sobre liberar saldo pequeno antigo retornou `MAX_SMALL_BALANCE_AGE_MS`, mas o limite padrão de um resultado por arquivo excluiu `shouldIgnoreMinimumPayout`. Com três resultados por arquivo, a função apareceu em segundo.

### Trabalho proposto

- Separar a seleção do primeiro resultado por arquivo da inclusão de evidências complementares.
- Experimentar a inclusão de um segundo trecho quando ele acrescentar uma função ou regra relevante, sem repetir o conteúdo já selecionado.
- Considerar papel do símbolo, relevância à pergunta, sobreposição de conteúdo e contribuição adicional.
- Preservar limites explícitos informados pelo usuário; documentar qualquer mudança no comportamento padrão.
- Evitar preferência universal por funções: uma consulta sobre um valor de configuração pode ser melhor respondida por uma constante.

### Critérios de aceitação

- A pergunta sobre saldo mínimo recupera `shouldIgnoreMinimumPayout` no top 5 pelo modo padrão.
- Perguntas cujo alvo é uma constante continuam encontrando essa constante.
- A inclusão complementar não volta a concentrar os resultados em poucos arquivos nem produz trechos redundantes.

## 2. Seleção de contexto pequeno — prioridade alta

**Problema observado:** com 1.200 tokens, o contexto da pergunta sobre saldo mínimo incluiu preferências, uma constante e configuração de conta, mas omitiu a função que decide a exceção.

### Trabalho proposto

- Avaliar a seleção de contexto separadamente do ranking da busca.
- Favorecer evidências que expliquem a implementação da regra perguntada.
- Penalizar redundância e trechos periféricos; experimentar reserva de orçamento para helpers complementares.
- Preferir trechos completos quando forem suficientes e couberem, mantendo indicação explícita de qualquer corte.
- Comparar estratégias sob o mesmo orçamento; não usar apenas o aumento do limite de tokens como solução.

### Critérios de aceitação

- `shouldIgnoreMinimumPayout` entra no contexto de 1.200 tokens da pergunta correspondente.
- Os casos de autenticação e voz continuam incluindo seus helpers centrais.
- Os limites de tokens e bytes continuam sendo respeitados.
- Quando faltar evidência, a saída permanece explicitamente incompleta.

## 3. Recuperação de helpers relacionados — prioridade seguinte

**Problema observado:** a pergunta ampla sobre criptografia de dados de repasse encontrou o fluxo de pagamentos, mas não trouxe `payoutDestinationCrypto.ts` no top 10. Restrição de pasta e reformulação recuperaram o helper.

### Trabalho proposto

- Experimentar uma segunda etapa limitada, a partir dos resultados mais relevantes.
- Usar imports e chamadas resolvidas para localizar possíveis helpers relacionados.
- Pontuar os candidatos adicionais pela relação com a pergunta, não apenas pela proximidade no grafo.
- Deduplicar os resultados e registrar a origem da expansão nos diagnósticos.
- Definir limites de profundidade, candidatos e tempo; preservar o resultado inicial quando a expansão não puder ser concluída.
- Evitar expansão indiscriminada para dependências genéricas e não presumir que o grafo seja exaustivo.

### Critérios de aceitação

- A pergunta ampla de criptografia recupera o helper relevante sem exigir que o usuário conheça o nome do arquivo.
- Consultas de controle não ganham dependências irrelevantes no lugar de resultados úteis.
- O ganho de cobertura e o custo de latência são medidos separadamente.

## 4. Indicação de evidência insuficiente — prioridade seguinte

**Problema observado:** uma consulta sobre Kubernetes/Kafka/EKS retornou código de certificados de assinatura e outros resultados pouco pertinentes. `answerSufficiency: not-assessed` evita uma promessa de suficiência, mas não orienta bem o consumidor.

### Trabalho proposto

- Montar exemplos positivos, negativos e ambíguos antes de definir a regra de sinalização.
- Experimentar sinais combinados, como suporte lexical/estrutural, coerência dos resultados e separação entre candidatos.
- Calibrar o indicador com diferentes consultas e, quando viável, mais de um modelo de embeddings.
- Distinguir evidência fraca de ausência comprovada: busca semântica não prova inexistência.
- Começar por um aviso explícito e orientação de refinamento, avaliando separadamente uma eventual política de abstenção.
- Evitar um corte arbitrário de similaridade que silencie resultados úteis.

### Critérios de aceitação

- Consultas negativas conhecidas recebem sinalização útil de evidência fraca.
- Resultados positivos não são descartados indiscriminadamente, inclusive em português.
- A documentação deixa claro que o indicador não é uma probabilidade calibrada de correção, salvo se isso for efetivamente demonstrado.

## Avaliação comum às quatro etapas

- Transformar os casos observados em regressões por **símbolo e regra**, além de arquivo.
- Definir os alvos antes de executar cada consulta; aceitar implementações alternativas quando justificadas pelo código.
- Manter perguntas novas fora dos ajustes iniciais para reduzir o risco de adaptar as heurísticas apenas aos exemplos conhecidos.
- Comparar as versões sobre o mesmo snapshot de código, índice, modelo e configuração.
- Separar medições com cache aquecido das consultas sem cache.
- Medir cobertura no top 5/top 10, posição do símbolo central, presença da regra no contexto, redundância, falsos positivos e latência mediana/p95.
- Avaliar contextos de 1.200 tokens e orçamentos maiores, mantendo comparações com o mesmo limite de bytes.
- Definir tolerâncias de regressão e de latência antes de selecionar a implementação final.
- Executar testes de regressão, typecheck e testes reais da CLI; validar o pacote instalado antes de considerar uma futura release concluída.

## Ordem de execução

1. Consolidar a base de avaliação e os casos de controle.
2. Implementar e medir diversidade flexível.
3. Implementar e medir seleção de contexto pequeno.
4. Experimentar recuperação de helpers, mantendo-a apenas se o ganho justificar custo e ruído.
5. Calibrar a indicação de evidência insuficiente.
6. Revisar os resultados combinados, documentar limitações e preparar uma proposta de release.

Os itens acima preservam os critérios de aceitação do plano original. A implementação recebeu testes isolados de comportamento e comparação A/B do conjunto; esta comparação não atribui separadamente o ganho de cada heurística. Consulte o relatório para os resultados e limitações da validação.
