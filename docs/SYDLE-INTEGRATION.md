# SYDLE - Compras E Pagamentos Internacionais

Ultima atualizacao: 2026-06-19

## Objetivo

Disponibilizar no portal de importacao um relatorio profissional de compras e
pagamentos internacionais vindos da SYDLE, com sincronizacao automatica a cada
15 minutos, historico auditavel e conciliacao com processos do portal.

## Estado Atual

Implementado no portal:

- Modulo API Node em `apps/api/src/modules/sydle`.
- Tabelas `sydle_purchase_payments` e `sydle_sync_runs`.
- Job agendado `sydle-sync` em `*/15 * * * *`.
- Tela web `/importacao/compras-pagamentos`.
- Exportacao CSV backend em `/api/sydle/payments-report/export.csv`.
- Rotas backend SYDLE e tela web restritas a administradores.
- Sync manual admin-only em `/api/sydle/sync-now`.
- Normalizador tolerante a campos comuns em PT-BR e ingles.

Nao implementado por falta de contrato externo:

- Endpoint real do projeto SYDLE.
- Credencial/token real.
- Nomes oficiais dos campos/objetos do projeto SYDLE.

Quando a SYDLE nao esta configurada, o job registra `status=skipped` em
`sydle_sync_runs` com motivo `sydle_not_configured`. Isso e intencional para
nao gerar erro falso em producao.

## Variaveis De Ambiente

As variaveis devem ficar em SOPS/env, nunca em `system_settings`.

```env
SYDLE_SYNC_ENABLED=false
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

Para ativar a integracao real:

1. Confirmar contrato/API/exportacao com o responsavel SYDLE.
2. Preencher variaveis no `.env.sops.yaml`.
3. Executar deploy oficial.
4. Rodar sync manual em `/importacao/compras-pagamentos`.
5. Conferir `sydle_sync_runs`, totais do relatorio e conciliacao com processos.

## Contrato Esperado

O cliente aceita payload JSON em array direto ou envelopes comuns:

- `data`
- `items`
- `results`
- `records`
- `content`
- `payments`

Campos reconhecidos pelo normalizador:

| Campo Interno     | Exemplos aceitos                                                  |
| ----------------- | ----------------------------------------------------------------- |
| `externalId`      | `externalId`, `id`, `_id`, `codigoPagamento`, `paymentId`         |
| `processCode`     | `processCode`, `processo`, `codigoProcesso`, `process`            |
| `purchaseRef`     | `purchaseRef`, `compra`, `referenciaCompra`                       |
| `purchaseOrder`   | `purchaseOrder`, `poNumber`, `pedidoCompra`, `ordemCompra`        |
| `proformaNumber`  | `proformaNumber`, `piNumber`, `numeroPi`, `proformaInvoice`       |
| `invoiceNumber`   | `invoiceNumber`, `invoice`, `ciNumber`, `numeroInvoice`           |
| `supplierName`    | `supplierName`, `supplier`, `fornecedor`, `exportador`, `shipper` |
| `purchaseAmount`  | `purchaseAmount`, `valorCompra`, `amountUsd`, `valorInvoice`      |
| `paidAmount`      | `paidAmount`, `valorPago`, `amountPaid`, `valorPagoUsd`           |
| `paymentStatus`   | `paymentStatus`, `statusPagamento`, `status`, `situacao`          |
| `sourceUpdatedAt` | `sourceUpdatedAt`, `updatedAt`, `ultimaAtualizacao`               |

Se o payload real divergir, ajustar somente `normalizer.ts` e adicionar fixture
sanitizada em teste.

## Banco De Dados

`sydle_purchase_payments` guarda o staging consolidado:

- Identificador externo unico `external_id`.
- Dados de compra, PI, invoice, fornecedor, valores, status e vencimento.
- Dados de cambio/BRL quando a SYDLE fornecer.
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
`unmatched`. O modulo nao sobrescreve `currency_exchanges` nem dados manuais de
processo.

## Seguranca

Classificacao de risco:

- `ALTO`: credencial SYDLE em SOPS/env.
- `ALTO`: payload financeiro sensivel em `raw_payload`; nao logar token, dados
  bancarios ou payload completo.
- `ALTO`: `raw_payload` e sanitizado antes de persistir chaves sensiveis comuns
  como token, senha, authorization, conta, agencia, IBAN, routing e PIX.
- `ALTO`: rotas SYDLE exigem admin.
- `MEDIO`: CSV exportado protege contra formula injection em Excel e pagina
  todos os registros filtrados em lotes internos.
- `MEDIO`: falha SYDLE nao quebra o portal; fica registrada em `sydle_sync_runs`.

## Operacao

Rotas:

- `GET /api/sydle/payments-report` admin-only
- `GET /api/sydle/payments-report/summary` admin-only
- `GET /api/sydle/payments-report/export.csv` admin-only
- `GET /api/sydle/sync-runs` admin-only
- `POST /api/sydle/sync-now` admin-only

Tela:

- `/importacao/compras-pagamentos` admin-only

Checklist de validacao operacional:

1. Abrir tela e confirmar estado de configuracao.
2. Rodar sync manual.
3. Conferir ultimo `sync_run`.
4. Validar amostra de registros com a SYDLE.
5. Conferir registros `unmatched`/`ambiguous`.
6. Exportar CSV com filtros ativos.
7. Conferir logs da API sem erro/fatal.

## Pendencias Para Ativacao Real

- Obter URL do ambiente/projeto SYDLE.
- Obter token de service account ou fluxo OAuth.
- Confirmar endpoint/listagem e paginacao.
- Confirmar campo incremental equivalente a `updatedAt`.
- Receber payload/export real sanitizado para fixture de teste.
- Validar com financeiro/comex a regra final de status e tipos de pagamento.
