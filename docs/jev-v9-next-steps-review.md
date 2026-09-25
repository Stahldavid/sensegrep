# Revisão das decisões e preparação da avaliação v9

Atualização: a execução autorizada posteriormente está documentada em
[avaliação das 30 consultas](evaluations/jev-v9-reviewed-2026-09-25/REPORT.md).
O texto abaixo registra a etapa anterior de preparação.

Escopo: revisão estática e preparação de exemplos. Nenhum teste, chamada ao
OpenRouter, alteração dos limiares de produção ou promoção de pesos nesta etapa.

## 1. Dois riscos confirmados no código

### Duplo veto semântico

Em `assessJevPacket`, um witness exige `supports >= .8`, localização válida,
`gap.choice === none` e `gap.none >= .8`. Suporte completo e ausência de lacuna
se sobrepõem semanticamente. Respostas divergentes são possíveis porque as
perguntas são independentes; exigir ambas pode aumentar abstenção. Isso é um
risco arquitetural confirmado, não uma taxa de erro medida.

Comparar, quando os testes forem retomados, sobre as mesmas respostas gravadas:

1. Política atual: referência conservadora.
2. Suporte + localização: gap orienta recuperação e diagnóstico, sem segundo veto.
3. Suporte + localização + veto apenas de lacuna concreta bem sustentada:
   `missing_definition` ou `missing_value`. A faixa de veto deve ser escolhida em
   desenvolvimento; não inventar outro corte como solução já calibrada.

Uma lacuna concreta identificada pelo código continua bloqueante. Não multiplicar
probabilidades nem tratar perguntas correlacionadas como confirmações independentes.
Escolher a política por falsas declarações de completude e cobertura útil, não
somente pela quantidade de respostas aceitas.

### Inspeção incompleta confundida com dependência ausente

`gateWitnessAssessment` rebaixa um veredito direto quando a inspeção está
incompleta, mesmo sem obrigação pendente. Isso mistura duas observações:
"há dependência relevante ausente" e "não inspecionamos todas as dependências".

Desenho recomendado para avaliação futura:

- Manter separadas suficiência das fontes selecionadas e cobertura da inspeção.
- Dependência comprovadamente necessária e ausente bloqueia o requisito afetado.
- Dependência de necessidade incerta conserva o estado de incerteza.
- Limite operacional sem dependência identificada deve aparecer como inspeção
  incompleta, sem inventar requisitos ausentes. Comparar se o veredito das fontes
  pode ser mantido com essa ressalva; não afirmar completude do repositório.
- Para perguntas delegadas, exigir implementação da dependência; para perguntas
  locais (onde ocorre um throw), não exigir que todo o fluxo seja conhecido.

Não relaxei o comportamento padrão antes da comparação. O resultado deve
continuar expondo limites e pendências mesmo se a política futura aceitar mais
evidências locais.

## 2. Base preparada

Arquivo: `scripts/fixtures/jev-v9-reviewed-curaai.json`.

Trinta consultas com perguntas, fatos esperados, símbolos, linhas, escopo,
hashes SHA-256 de todos os arquivos revisados e commit da fonte:

| Divisão | Consultas | Famílias |
|---|---:|---|
| Desenvolvimento | 15 | Política de repasses, criptografia de repasses, horários |
| Validação | 5 | Contagem de notificações, interpretação de relatório ITI |
| Reservadas | 10 | SMS, sessão Clerk |

Nenhuma família atravessa divisões. Há três famílias de desenvolvimento para
validação por grupos no AutoResearch. São 30 consultas em sete famílias, não
30 amostras de implementações independentes; reportar médias por família também.
Os casos reservados foram revisados manualmente, não são um holdout externo
cego e ainda não foram executados. Não transferir paráfrases entre conjuntos.
A ampliação preserva os dez casos iniciais e acrescenta vinte perguntas distintas.
A conferência desta etapa abrangeu integridade do manifesto, contagens, símbolos,
linhas e hashes; não executou buscas, testes de comportamento ou inferência.

Há dois negativos distintos: ausência de uma implementação no escopo de um
arquivo e resposta negativa demonstrada pelo fluxo de controle. Não pontuar
ambos como ausência de evidência.

O formato é um manifesto revisado, não entrada diretamente compatível com todos
os runners existentes. Na integração futura, separar campos enviados ao modelo
(consulta e fontes) dos rótulos usados pelo avaliador. Conferir hashes antes da
execução; se houver mudança, revisar os fatos, não atualizar o hash cegamente.

Transformações a preparar quando retomarmos os testes: remover helper necessário,
adicionar constante igual sem vínculo, inserir chamada incidental, truncar fonte,
inverter a ordem e alterar conteúdo mantendo ID. Aplicar somente em cópias de
avaliação, preservando a família original na divisão de dados.

## 3. Sequência posterior

1. Regressões locais sem inferência, depois comparação local / Jev seleção /
   Jev seleção e recuperação nas mesmas consultas e orçamento de 4.000 tokens.
2. Medir fatos cobertos, helpers necessários presentes, falsos completos,
   abstenções e latência. A presença do arquivo sozinha não basta.
3. Gravar respostas e reutilizá-las para comparar políticas sem repetir inferência.
4. Revisar perguntas manualmente a partir dos erros de desenvolvimento. Reservar
   as famílias separadas até congelar contrato, política e critérios de promoção.
5. Antes de uma rodada paga, conferir preço vigente e impor orçamento agregado
   incluindo tentativas e concorrência. O teto autorizado continua US$0,50;
   nesta etapa o gasto foi US$0.

Referências: [Confidence](https://docs.typesafe.ai/confidence),
[AutoResearch](https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery),
[skill TypeSafe](C:/Users/stahl/.agents/skills/typesafe-ai/SKILL.md).
