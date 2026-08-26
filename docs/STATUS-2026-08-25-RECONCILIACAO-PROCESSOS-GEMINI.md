# Status — Reconciliação De Processos E Documentos Gemini — 2026-08-25

## Objetivo E Escopo

Sessão de continuação, correção de bug, auditoria e operação de manutenção no
ambiente de validação. O escopo foi:

- diagnosticar o erro CSP da fonte externa e o crash de moeda `PREPAID`;
- reconciliar a lista de processos com a planilha oficial Follow Up;
- preservar documentos e linhagem válidos durante a remoção de registros de
  validação obsoletos;
- reprocessar os documentos pendentes com Vertex/Gemini, revisar confiança e
  executar validações cruzadas;
- corrigir as causas de recorrência no código, sem push ou deploy.

## Fatos Observados

- A aplicação carrega Inter pelo Google Fonts e a CSP permite apenas `'self'`
  e `https://fonts.gstatic.com` em `font-src`. Não existe referência a
  `frontend-cdn.perplexity.ai` no repositório. A tentativa foi uma injeção de
  contexto externo ao aplicativo, e o bloqueio da CSP foi o comportamento
  seguro esperado.
- O crash foi causado por `Intl.NumberFormat` receber `PREPAID` como código de
  moeda. Em um OHBL, o preenchimento determinístico reaproveitava um número de
  outra linha mesmo após a IA retornar corretamente `freightValue = null`.
- A planilha oficial contém 117 processos operacionais a partir de
  `2025-05-01`. A reconciliação semântica das 115 colunas confirmou os 117
  códigos e as 117 ETDs; diferenças de hash anteriores eram apenas CRLF/LF.
- Após a reconciliação há 117 processos, 117 linhas de follow-up, 51 documentos
  em 12 processos, zero documento pendente, zero lease ativo e zero par
  inválido `PREPAID|COLLECT + freightValue`.
- Seis documentos com falha/confiança zero foram reprocessados. Todos
  terminaram processados e `trusted`; confiança média final de 93,23%, com
  cinco acima de 90% e um packing list em 86,63%.
- Confiança de modelo não é acurácia contra ground truth. A meta de acurácia
  acima de 90% não pode ser garantida sem amostra rotulada e aceite humano.

## Operação De Dados

- Backup criado antes da mutação:
  `/home/nicolas/backups/importacao/importacao_2026-08-25_165234.pgdump`.
- Uploads e volumes de certificação também foram arquivados; o dump passou em
  `pg_restore --list` e em restauração integral no banco temporário
  `importacao_reconcile_test`.
- Importação: 117 linhas, 31 processos criados, 86 atualizados, zero erro.
- Reconciliação serializável: 18 registros de validação removidos, 18
  documentos válidos movidos para os processos oficiais e 31 documentos
  comprovadamente duplicados/mal classificados removidos.
- A operação removeu 1.405 alertas e 32 comunicações ligados exclusivamente aos
  registros descartados. Uma linha de staging Sydle foi preservada e remapeada.
- Dez PDFs de apoio sem extrator foram encerrados como `other`, mantendo arquivo
  e auditoria, sem chamada de IA. Dois deles estavam incorretamente tipados como
  `espelho`, embora o parser de espelho aceite XLSX.
- O valor de planilha `SIM`/`NÃO` deixou de ocupar `correction_status`, reservado
  ao workflow. O valor foi preservado em
  `ai_extracted_data.sheetDocumentCorrection`; somente o processo realmente em
  correção permaneceu `pending_correction`.

O rollback integral deve usar o dump e os arquivos do mesmo timestamp em uma
janela de incidente. Ele não deve ser executado automaticamente, pois também
reverteria alterações legítimas posteriores ao backup.

## Gemini E Validações

| Documento | Tipo         | Confiança final | Trust   | Resultado |
| --------: | ------------ | --------------: | ------- | --------- |
|       117 | invoice      |          95,29% | trusted | concluído |
|       120 | invoice      |          94,91% | trusted | concluído |
|       122 | packing list |          86,63% | trusted | revisão   |
|       129 | invoice      |          93,66% | trusted | concluído |
|       151 | invoice      |          96,14% | trusted | concluído |
|       154 | invoice      |          92,72% | trusted | concluído |

O packing list inicialmente parava no parser determinístico com 64,76% porque
uma linha de contato era interpretada como item. Uma execução controlada com
Gemini Flash elevou o resultado a 86,63%, 36 campos persistidos e trust
`trusted`. O código agora rejeita esse falso positivo e cai para IA, mas essa
correção ainda não foi implantada.

Validações atuais dos dois processos reprocessados de maior risco:

- processo 275, validação final: 29 checks, 13 passed, 9 failed, 6 warning e 1
  skipped; correção documental requerida;
- processo 259, revisão parcial sem alterar o estado `completed`: 29 checks, 10
  passed, 9 failed e 10 warning.

Categorias de falha observadas incluem exportador/endereço, referência de
processo, portos, volumes, pesos, itens, valores/quantidades de invoice,
condição de pagamento e sequência de datas. Os valores comerciais não são
reproduzidos neste documento; devem ser revisados na UI pelos responsáveis da
área contra os arquivos originais.

## Revisão Processo A Processo Com Evidência Documental

Dos 117 processos oficiais, 12 possuem documentos no sistema; os outros 105
foram reconciliados nos campos mestres, mas não têm arquivo local que permita
análise documental por IA. A lista abaixo usa o último resultado persistido,
exceto onde a revisão parcial controlada é indicada.

| Processo        | Docs | Falhas | Correções/revisão prioritária                                    |
| --------------- | ---: | -----: | ---------------------------------------------------------------- |
| IM0712602NB     |    3 |      4 | conjunto documental, datas, valor FUP e itens                    |
| IM0732604NB     |   10 |      3 | exportador, endereço do fornecedor e unidade                     |
| PK1182601NB     |    4 |      0 | só documentos de apoio; classificação manual                     |
| PK1192512XI     |    9 |      0 | só documentos de apoio; classificação manual                     |
| PK2002601TJ     |    1 |      6 | conjunto, referência, exportador/endereço, datas/valor           |
| PK2042602NB     |    1 |      0 | documento de apoio; classificação manual                         |
| PK2052602TJ     |    5 |      9 | revisão parcial: partes, itens, volumes/pesos, pagamento e datas |
| PK2062602NB     |    4 |      9 | referência, partes, pesos, pagamento, datas e fabricante         |
| PK2072602NB     |    1 |      2 | conjunto documental e datas                                      |
| PK2082605SZ LCL |    5 |      2 | conjunto documental e datas                                      |
| PK2092606SZ     |    7 |      9 | partes/portos, itens, volumes/pesos, pagamento e valor           |
| PK2112606NB     |    1 |      1 | conjunto documental incompleto                                   |

Falha zero nesta tabela não significa acurácia certificada: os três processos
compostos somente por `other` não têm checks automáticos aplicáveis. A área deve
decidir se esses PDFs são apenas evidência de apoio ou se precisam ser
reclassificados e ter um extrator dedicado.

## Correções De Código

- `formatCurrency` passou a normalizar e degradar com segurança para rótulo
  textual quando a moeda não é ISO.
- O card de processo trata `PREPAID` e `COLLECT` como condição de pagamento do
  frete, não como moeda.
- O parser de BL mantém `freightValue = null` para essas condições e limita a
  busca determinística à linha de frete.
- O parser determinístico de packing list ganhou gate de qualidade para não
  suprimir o Gemini quando contato/cabeçalho parece uma linha de item.
- O importador Follow Up foi convertido para ESM, ganhou parsing localizado de
  número, percentual e data e preserva projeções de documentos no JSON.
- O fallback legado com credencial padrão do importador foi removido;
  `DATABASE_URL` agora é obrigatório e continua redigido no log.
- O operador de reprocessamento aceita seleção exata por `--document-id`.
- Scripts SQL serializáveis, com assertions e auditoria, documentam a
  reconciliação e a normalização de workflow.

## Segurança, Riscos E Limitações

- **CRÍTICO:** o canal Google Chat respondeu que a chave da API é inválida
  durante as validações automáticas. A extração persistiu, mas alertas podem não
  alcançar a equipe.
- **ALTO:** as correções locais ainda não estão na revisão implantada
  `ce70f41`; nenhum push ou deploy foi autorizado nesta sessão.
- **ALTO:** o packing list de 86,63% e os 18 checks falhos nos dois processos
  exigem decisão humana. Não promover como acurácia comprovada.
- **MÉDIO:** documentos tabulares grandes precisaram de janela e saída maiores;
  o produto precisa de chunking/continuação para não depender de execução
  operacional especial.
- **MÉDIO:** um processo `completed` não aceita reentrada em validação final. A
  sessão executou revisão parcial, sem regressão automática de estado.
- A automação Playwright chegou apenas ao login, pois não havia sessão de
  navegador autenticada reutilizável. O smoke autenticado da tela permanece
  para depois do deploy.

## Estado De Retomada

- Dados do ambiente de validação reconciliados e sem processamento pendente.
- Resultado abaixo de 90% e divergências de negócio explicitamente em revisão.
- Lint, typecheck API/web, 965 testes API, 131 testes web, 3 testes dos helpers e
  builds API/web passaram. `git diff --check` e Prettier dos arquivos alterados
  passaram.
- O `npm run format:check` global continua falhando em 19 arquivos preexistentes
  e fora do diff; eles não foram reformatados em massa. O build web manteve o
  warning conhecido do chunk de detalhe de processo acima de 500 kB.
- Todos os containers permaneceram healthy, `/api/health` respondeu `ok`, o
  proxy público respondeu HTTP 200 e o header CSP publicado preserva o
  `font-src` restritivo.
- Próximo gate: revisão humana dos dois processos sinalizados, seguida de
  autorização explícita para commit/push/deploy e smoke autenticado.
