# Correções da avaliação de 24/09/2026

Implementação local na branch `works/fix-evaluation-regressions`, baseada na versão
1.16.0. Estes resultados se referem à CLI compilada do repositório, não ao pacote
global publicado.

## Mudanças

- Arquivos pequenos passam pelo parser e preservam linguagem, símbolos e chamadas.
  O fallback também conserva linguagem e trechos curtos. Política de chunking 6:
  a próxima indexação explícita reconhece a necessidade de reconstrução.
- O contexto aplica o orçamento antes de limitar o número final de resultados.
  A seleção considera relevância, cobertura adicional de termos, papel do arquivo
  e referências textuais em candidatos relevantes. O ganho por tamanho é limitado.
  Testes e contratos continuam disponíveis e podem ser priorizados explicitamente.
- `rankingStrength` substitui a apresentação ambígua de `confidence` nos cards
  diagnósticos; a saída interna completa preserva o alias para compatibilidade.
  `answerSufficiency: "not-assessed"` separa conclusão da execução de suficiência.
- O grafo atribui chamadas ao menor símbolo indexado que as contém. Referências
  expõem origem, destino, método de resolução e linha da chamada quando disponível.
  O cache foi versionado e o denominador da cobertura está documentado.
- Duplicatas com até 4096 candidatos e distância cosseno usam vetores normalizados
  e distâncias simétricas em memória. Há verificação de prazo, cancelamento,
  continuação e tempos separados de leitura, preparação e busca de vizinhos.
- Clusters exigem compatibilidade com todos os membros, evitando agrupamentos
  gigantes formados por uma cadeia de semelhanças. Nomes preferem símbolos/arquivos;
  imports comuns de frameworks e testes têm menos influência.
- `search --max-output-bytes` limita o JSON completo, incluindo formatação e UTF-8.
  O mínimo aceito é 256 bytes; limites inválidos retornam JSON de erro e exit code 2.

## Validação

- Build e type-check dos workspaces passaram; versões dos pacotes consistentes.
- Suíte completa: 44 arquivos, 232 testes aprovados. Depois, duas regressões de
  seleção por papel/referência foram adicionadas; a execução direcionada passou
  com 25 testes. Total de testes na árvore final: 234.
- Fixture real indexada com Ollama, incluindo arquivos menores que 200 caracteres:
  filtros Python, Java e Vue retornaram resultados; o grafo encontrou
  `purchase -> authorizeDebit -> readBalance` via alias importado e distinguiu
  chamada direta de chamada agendada.
- Contexto de concorrência de voz com 1200 tokens passou a incluir
  `markContextConsumed`, ausente na avaliação anterior. Contexto de autenticação
  manteve os helpers de refresh de sessão. Ambos indicam orçamento incompleto.
- Busca de duplicatas com os mesmos parâmetros da avaliação anterior:
  1628 candidatos, limite 1500, prazo 5 segundos. Antes: 44 processados; depois:
  873 processados (aproximadamente 20 vezes mais nesta medição).
- Continuação: 627 candidatos restantes processados, sem timeout. Os 24 grupos
  acumulados foram iguais aos 24 da execução única de 1500 candidatos.
  O resultado continua incompleto devido aos 128 candidatos excluídos pelo limite.
- Escopo pequeno de duplicatas: 219/219 candidatos e os mesmos quatro grupos;
  1,524 s de processo, contra 1,511 s na avaliação anterior. O ganho é no escopo amplo.
- Consulta ampla de pagamentos: maior cluster retornado caiu de 52 para 18 membros;
  os títulos distinguem processamento de webhook, reconciliação e mutações de status.
- JSON minimal/content/diagnostic/full com pretty printing respeitou 1800 bytes;
  content respeitou também 1500 bytes. Quando os diagnósticos não cabem, a saída
  degrada para um envelope incompleto e válido.
- A consulta negativa sobre Kubernetes continua podendo retornar um vizinho
  semântico; a saída agora declara explicitamente que suficiência não foi avaliada.

## Limites e aplicação

Os tempos são observações locais, não um benchmark controlado de hardware.
O ganho de duplicatas vem do algoritmo de comparação, não de uso adicional da GPU.
Ranking e contexto continuam heurísticos; não garantem encontrar toda regra de negócio.
O grafo não substitui resolução pelo compilador para chamadas dinâmicas, re-exports
e outras formas que não resolve. A contagem de tokens de saída continua estimada.

O pacote npm, a CLI global e a skill instalada permanecem na versão publicada.
Depois de disponibilizar esta implementação, execute `sensegrep index --no-watch`
nos projetos para reconstruir índices com a política antiga. Não houve reconstrução
do índice principal durante estes testes; apenas a fixture temporária foi indexada.
