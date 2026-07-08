# SYDLE - Compras E Pagamentos Internacionais

Ultima atualizacao: 2026-07-08

## Objetivo

Disponibilizar no portal de importacao um relatorio profissional de compras e
pagamentos internacionais vindos da SYDLE, com sincronizacao automatica a cada
10 minutos, historico auditavel e conciliacao com processos do portal.

## Estado Atual

Implementado no portal:

- Modulo API Node em `apps/api/src/modules/sydle`.
- Tabelas `sydle_purchase_payments` e `sydle_sync_runs`.
- Job agendado `sydle-sync` em `*/10 * * * *`.
- Tela web `/importacao/compras-pagamentos`, menu `Importacao > Operacional >
Compras/Pagamentos SYDLE` e atalho no portal para usuários autenticados do
  módulo de importação.
- A tela exibe uma visão operacional e uma visão unificada alinhada ao Excel/CSV,
  mas sem duplicidades internas (`Código do processo` e `Compra`) e com
  conciliação em linguagem de negócio (`Conciliação Portal` e `Evidência conciliação`).
- Exportacao CSV backend em `/api/sydle/payments-report/export.csv`.
- Exportacoes CSV/XLSX/PDF preservam as colunas do relatório Analytics/CSV da
  SYDLE quando a fonte as fornece; CSV/PDF saem formatados para leitura e XLSX
  usa células nativas de data/moeda para análise no Excel.
- Leitura/exportação do relatório SYDLE liberadas para usuários autenticados do
  módulo de importação.
- Sync manual, configuração, histórico de sync e payload bruto admin-only.
- Normalizador tolerante a campos comuns em PT-BR e ingles.
- Fonte real Sydle One por `SYDLE_SOURCE_TYPE=sydle_one_class`, com login em
  `sys/auth/signIn`, cookie de sessao e busca `POST _classId/{id}/_search`.
- Classe real de pagamento internacional validada em 2026-06-19:
  `68bf1179b042c72f03993928` (`Solicitacao de Pagamento Internacional/current`).
- O cliente achata `paymentData[]` em uma linha por parcela, resolve moeda,
  ticket e status quando a API permite, e preserva compatibilidade com o modo
  generico legado.
- `scripts/deploy.sh` bloqueia deploy quando `SYDLE_SYNC_ENABLED=true`, salvo
  rollout financeiro aprovado com `ALLOW_SYDLE_SYNC_DEPLOY=1`.

Quando a SYDLE nao esta configurada, o job registra `status=skipped` em
`sydle_sync_runs` com motivo `sydle_not_configured`. Isso e intencional para
nao gerar erro falso em producao.

## Validacao Em Producao - 2026-06-19

- Commit implantado: `5362dd3a343a955c4e694cde3df457c92b99c512`.
- Deploy executado com `ALLOW_SYDLE_SYNC_DEPLOY=1`, health interno e publico OK.
- Sync manual `sydle_sync_runs.id=109`: `success`, `fetched=20`,
  `created=20`, `errors=0`.
- Cron seguinte `sydle_sync_runs.id=110`: `success`, `fetched=2`,
  `updated=2`, `errors=0`; o comportamento e esperado pelo overlap de cursor
  de 5 minutos.
- Totais iniciais: 20 linhas, USD 154.847,83 comprados, USD 57.142,08 pagos e
  USD 97.705,75 em aberto.
- Conciliacao inicial: 20 `unmatched`, pois a permissao atual da API le ticket
  SYDLE e parcelas, mas nao os formularios que poderiam expor PI/invoice/processo
  de importacao/fornecedor.

## Variaveis De Ambiente

As variaveis devem ficar em SOPS/env, nunca em `system_settings`.

```env
SYDLE_SYNC_ENABLED=false
SYDLE_SOURCE_TYPE=generic
SYDLE_BASE_URL=
SYDLE_API_TOKEN=
SYDLE_PAYMENTS_PATH=/api/purchase-payments
SYDLE_AUTH_HEADER=Authorization
SYDLE_AUTH_SCHEME=Bearer
SYDLE_UPDATED_AFTER_PARAM=updatedAfter
SYDLE_PAGE_PARAM=page
SYDLE_PAGE_SIZE_PARAM=pageSize
SYDLE_PAGE_SIZE=200
SYDLE_TIMEOUT_MS=30000
```

Modo Sydle One real:

```env
SYDLE_SYNC_ENABLED=true
SYDLE_SOURCE_TYPE=sydle_one_class
SYDLE_BASE_URL=https://grupounico.sydle.one
SYDLE_APP=main
SYDLE_USER=
SYDLE_PASSWORD=
SYDLE_CLASS_ID=68bf1179b042c72f03993928
SYDLE_DATE_FIELD=_lastUpdateDate
SYDLE_PAGE_SIZE=200
SYDLE_TICKET_CLASS_ID=5d446dfc62d9656275a47d69
SYDLE_TICKET_STATUS_CLASS_ID=5cacdc04a50bfe4c0d3e5c74
SYDLE_CURRENCY_CLASS_ID=000000000000000000000059
```

Para ativar ou alterar a integracao real:

1. Preencher variaveis no `.env.sops.yaml` ou cofre operacional, nunca em texto
   claro versionado.
2. Executar deploy oficial com `ALLOW_SYDLE_SYNC_DEPLOY=1` apenas em rollout
   aprovado.
3. Rodar sync manual em `/importacao/compras-pagamentos` ou via rotina
   operacional autenticada.
4. Conferir `sydle_sync_runs`, totais do relatorio e conciliacao com processos.
5. Validar amostra com financeiro/comex antes de considerar o job real aprovado.

## Contrato Esperado

O cliente aceita payload JSON em array direto ou envelopes comuns:

- `data`
- `items`
- `results`
- `records`
- `content`
- `payments`
- Sydle One `_search`: `hits.hits[]._source`

### Sydle One - Pagamento Internacional

Fonte validada:

- `POST /api/1/main/_classId/68bf1179b042c72f03993928/_search`
- Paginacao por `search_after`, ordenada por `_lastUpdateDate` e `_id`.
- Filtro incremental por `range` em `_lastUpdateDate`, com overlap de 5
  minutos aplicado pelo service.

Campos principais observados:

- Top-level: `_id`, `_creationDate`, `_lastUpdateDate`, `approved`,
  `billOfLanding`, `ticket`, `requestData`, `paymentData[]`.
- Parcela: `paymentData[]._id`, `paymentAmount`, `paymentCurrency._id`,
  `expirationDate`, `paymentDeadlineAfterShipment`, `exception`, `reason`.
- Referencias resolvidas quando permitido:
  - Ticket: `5d446dfc62d9656275a47d69` para `code`, `searchCode`, `status` e
    `attendanceConclusionDate`.
  - Status ticket: `5cacdc04a50bfe4c0d3e5c74` para `name`/`identifier`.
  - Moeda: `000000000000000000000059` para `iso`.

Regras atuais de normalizacao Sydle One:

- `externalId`: `sydle-one:{requestId}:{paymentId}`.
- `purchaseRef`: `SYDLE-{ticket.code}` quando o ticket esta disponivel.
- `purchaseAmount`: valor da parcela `paymentAmount`.
- `paidAmount`: valor integral quando o ticket esta concluido; caso contrario
  `0`.
- `openAmount`: `0` quando concluido; caso contrario valor da parcela.
- `dueDate`: `expirationDate`.
- `paymentStatus`: `paid` para ticket concluido; caso contrario `open`.
- `sourceUpdatedAt`: `_lastUpdateDate` da solicitacao.

### Descoberta De Dados Complementares Sydle

Estado comprovado no repositorio e na validacao operacional:

- Confirmado/acessivel: classe `Solicitacao de Pagamento Internacional/current`
  (`68bf1179b042c72f03993928`), `paymentData[]`, ticket, status do ticket e
  moeda.
- Confirmado/acessivel em 2026-07-08: `requestData` dentro da classe principal,
  incluindo `invoiceCode`, `processCode`, `paymentType`, `emissionDate`,
  `endDateForm`, `departureDate`, refs de `brand` e `recipient`.
- Bloqueado/pendente por permissao em 2026-07-08: classes ou view financeira
  para cambio, BRL, banco, contrato e remessa.
- Nao ha evidencia local suficiente para afirmar que nao existem outras tabelas
  ou classes SYDLE; essa confirmacao depende de acesso ao catalogo/contrato da
  SYDLE ou apoio do time responsavel pela plataforma.

Campos que devem ser solicitados na view/API consolidada:

- Chaves de conciliacao: `processCode`, `purchaseRef`, `purchaseOrder`,
  `proformaNumber`/`piNumber`, `invoiceNumber`, `supplierName`/exportador e
  marca quando existir.
- Parcela/liquidacao: status real da parcela, tipo real da SYDLE
  (`Deposit in Advance`, `Balance before Shipment`, `Balance after Shipment`),
  data de vencimento, data de pagamento/liquidacao, valor pago e valor aberto.
- Financeiro: moeda, valor original, taxa de cambio, valor BRL, banco, contrato
  de cambio, remessa/remittance e referencia de comprovante quando permitido.
- Auditoria: `_id`, `_lastUpdateDate`, usuario/sistema de atualizacao e status
  de aprovacao.

Enquanto a fonte financeira nao existir, o portal deve manter os campos
financeiros sensiveis vazios quando a SYDLE nao fornece. Pago/aberto vem do
status do ticket, e tipo de pagamento vem de `requestData.paymentType`
(`depositInAdvance`, `beforeShipment`, `afterShipment`). Nao expandir os
`_source.excludes` para anexos, documentos ou campos bancarios sem aprovacao de
seguranca/financeiro; preferir view/API ja sanitizada pela SYDLE.

Campos reconhecidos pelo normalizador:

| Campo Interno                  | Exemplos aceitos                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| `externalId`                   | `externalId`, `id`, `_id`, `codigoPagamento`, `paymentId`                                 |
| `sydleProtocol`                | `sydleProtocol`, `protocolo`, `ticketCode`, `sydleTicketCode`                             |
| `processCode`                  | `processCode`, `processo`, `codigoProcesso`, `process`                                    |
| `purchaseRef`                  | `purchaseRef`, `compra`, `referenciaCompra`                                               |
| `purchaseOrder`                | `purchaseOrder`, `poNumber`, `pedidoCompra`, `ordemCompra`                                |
| `proformaNumber`               | `proformaNumber`, `piNumber`, `numeroPi`, `proformaInvoice`                               |
| `invoiceNumber`                | `invoiceNumber`, `invoice`, `ciNumber`, `numeroInvoice`                                   |
| `supplierName`                 | `supplierName`, `supplier`, `fornecedor`, `exportador`, `shipper`                         |
| `purchaseAmount`               | `purchaseAmount`, `valorCompra`, `amountUsd`, `valorInvoice`                              |
| `paidAmount`                   | `paidAmount`, `valorPago`, `amountPaid`, `valorPagoUsd`                                   |
| `paymentStatus`                | `paymentStatus`, `statusPagamento`, `status`, `situacao`                                  |
| `paymentType`                  | `paymentType`, `depositInAdvance`, `beforeShipment`, `afterShipment`, `Tipo de pagamento` |
| `invoiceIssuedDate`            | `Data de emissão Invoice/PI`, `invoiceIssueDate`, `piIssueDate`, `emissionDate`           |
| `taskCreatedAt`                | `Data criação da tarefa`, `taskCreationDate`, `endDateForm`, `_creationDate`              |
| `shipmentDate`                 | `Data de embarque`, `shipmentDate`, `shippingDate`, `departureDate`                       |
| `paymentDeadlineAfterShipment` | `Prazo para pagamento pós embarque`, `paymentDeadlineAfterShipment`                       |
| `exceptionStatus`              | `Exceção`, `exception`                                                                    |
| `exceptionReason`              | `Motivo da exceção`, `reason`                                                             |
| `sourceUpdatedAt`              | `sourceUpdatedAt`, `updatedAt`, `ultimaAtualizacao`                                       |

Se o payload real divergir, ajustar somente `normalizer.ts` e adicionar fixture
sanitizada em teste.

### Relatório Analytics/CSV

O arquivo baixado da SYDLE Analytics em 2026-07-08 foi tratado como contrato
complementar de staging. As 16 colunas observadas são: protocolo, número da
invoice, beneficiário, marca, tipo de pagamento, data de vencimento, moeda de
pagamento, valor a pagar, data de emissão Invoice/PI, data de criação da tarefa,
exceção, motivo da exceção, código do processo, data de embarque, prazo para
pagamento pós-embarque e data da última alteração.

Quando a fonte não traz identificador único por parcela, o normalizador deriva
`externalId` por protocolo + invoice + vencimento + valor + prazo pós-embarque,
evitando colapsar parcelas diferentes do mesmo protocolo.

Quando uma mudança de mapeamento adiciona colunas novas, usar
`POST /api/sydle/sync-now?full=1` como admin para reprocessar todo o conjunto via
API SYDLE One. O cron de 10 minutos permanece incremental e continua usando
cursor `_lastUpdateDate` com overlap de 5 minutos.

## Banco De Dados

`sydle_purchase_payments` guarda o staging consolidado:

- Identificador externo unico `external_id`.
- Colunas de paridade com o relatório Analytics/CSV: `sydle_protocol`,
  `invoice_issued_date`, `task_created_at`, `shipment_date`,
  `payment_deadline_after_shipment`, `exception_status` e `exception_reason`.
- Dados de compra, PI, invoice, fornecedor, valores, status e vencimento.
- Dados de cambio/BRL quando a SYDLE fornecer.
- O relatorio nao usa `currency_exchanges` nem outros dados financeiros do
  portal para estimar câmbio/BRL; campos financeiros vazios na SYDLE permanecem
  vazios no relatório.
- `raw_payload` para auditoria e troubleshooting.
- `process_id`, `match_status`, `match_score`, `match_reason` para conciliacao.

`sydle_sync_runs` guarda execucoes:

- `status`: `running`, `success`, `partial`, `failed`, `skipped`.
- `trigger`: `cron` ou `manual`.
- Contadores de lidos, criados, atualizados, conciliados, nao conciliados e erros.
- Cursor incremental `cursor_from` / `cursor_to`.

O cursor incremental usa o maior `sourceUpdatedAt`/`updatedAt` recebido da
fonte, nao o horario local de inicio da sync. A proxima consulta aplica overlap
de 5 minutos sobre o ultimo cursor gravado para reduzir risco de perda por
empate de timestamp ou atraso de commit na SYDLE.

Datas de cursor aceitam ISO e formatos brasileiros como
`18/06/2026 10:10:00`, preservando hora/minuto/segundo para evitar avancos
incorretos do cursor incremental.

## Conciliacao

Prioridade de match:

1. `processCode` exato.
2. `purchaseRef` em `import_processes.purchase_ref`.
3. PI/invoice/pedido em dados extraidos do processo.
4. Marca, fornecedor/exportador e valor como reforco de score.

PI, invoice ou pedido isolado nao bastam para vinculo automatico. Se houver
mais de um candidato ou score insuficiente, o registro fica `ambiguous` ou
`unmatched`. O modulo nao sobrescreve `currency_exchanges`, nao usa
`currency_exchanges` para preencher o relatorio SYDLE e nao altera dados manuais
de processo.

## Seguranca

Classificacao de risco:

- `ALTO`: credencial SYDLE em SOPS/env.
- `ALTO`: payload financeiro sensivel em `raw_payload`; nao logar token, dados
  bancarios ou payload completo.
- `ALTO`: `raw_payload` e sanitizado antes de persistir chaves sensiveis comuns
  como token, senha, authorization, conta, agencia, IBAN, routing e PIX.
- `MEDIO`: leitura/exportação SYDLE ficam disponíveis a todos os usuários
  autenticados da importação; payload bruto, configuração e sync seguem
  admin-only.
- `MEDIO`: CSV exportado protege contra formula injection em Excel e pagina
  todos os registros filtrados em lotes internos.
- `MEDIO`: falha SYDLE nao quebra o portal; fica registrada em `sydle_sync_runs`.

## Operacao

Rotas:

- `GET /api/sydle/payments-report` autenticado
- `GET /api/sydle/payments-report/summary` autenticado
- `GET /api/sydle/payments-report/export.csv` autenticado
- `GET /api/sydle/payments-report/export.xlsx` autenticado
- `GET /api/sydle/payments-report/export.pdf` autenticado
- `GET /api/sydle/payments-report/:id` autenticado — detalhe de UMA
  compra/pagamento; `rawPayload` da SYDLE fica oculto para nao-admin. Consumido
  pelo drawer "abrir a compra" no relatorio.
  Registrado APOS `/summary` e `/export.csv` para o `:id` nao captura-los.
- `GET /api/sydle/sync-runs` admin-only
- `POST /api/sydle/sync-now` admin-only

Tela:

- `/importacao/compras-pagamentos` visivel para usuarios autenticados do modulo
  de importacao.
- Menu: `Importacao > Operacional > Compras/Pagamentos SYDLE`.
- Portal: atalho `Pagamentos SYDLE` para usuarios com acesso a importacao.
- Tabela/mobile exibem compra, fornecedor, PI, invoice, status, valores USD,
  cambio, BRL, banco, contrato, remessa, vencimento, pagamento/agendamento,
  conciliacao, motivo de match e timestamps SYDLE/Portal.

Checklist de validacao operacional:

1. Abrir tela e confirmar estado de configuracao.
2. Rodar sync manual.
3. Conferir ultimo `sync_run`.
4. Validar amostra de registros com a SYDLE.
5. Conferir registros `unmatched`/`ambiguous`.
6. Exportar CSV com filtros ativos.
7. Conferir logs da API sem erro/fatal.

## Pendencias Para Ativacao Real

- Validar com financeiro/comex a regra final de status e tipos de pagamento
  sobre amostra da producao.
- Confirmar se a SYDLE deve expor fornecedor, PI, invoice e processo de
  importacao no payload principal ou por uma visao/API com permissao de leitura.
- Avaliar service account dedicada, pois o login atual por `GET` envia
  credenciais em query string da propria SYDLE.
