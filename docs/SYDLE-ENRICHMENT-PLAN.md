# SYDLE — Enriquecimento de Dados Complementares (Fase 2)

Última atualização: 2026-06-20

## Contexto

O job agendado `sydle-sync` (`*/15 * * * *`) **já busca e alimenta a base**
(`sydle_purchase_payments`). A tabela **já tem** as colunas complementares
(`supplier_name`, `proforma_number`, `invoice_number`, `purchase_order`,
`process_code`, `exchange_rate`, `amount_brl`, `bank_name`, `contract_number`,
`remittance_id`). O que faltava era o caminho **Sydle One**
(`flattenSydleOneInternationalPaymentRows` em `apps/api/src/modules/sydle/client.ts`)
**não populava** essas colunas — só os campos calculados (purchaseRef, amounts,
status). Os dados ficavam preservados apenas em `raw_payload`/`rawSydleOne`.

Não é falta de scheduler nem de base. O bloqueio real é **acesso/forma do dado**:
saber se fornecedor/PI/invoice/processo/câmbio vêm no payload do request/ticket
(e sob quais nomes) ou se estão atrás das forms `InternationalPaymentOpenForm` /
`RequestData`, que retornam **403** para a credencial `SYDLE_USER`.

## O que já está implementado (Fase 1 — neste commit)

1. **Probe read-only** — `scripts/sydle-class-discovery.mjs`.
   Descobre campos (amostra com `_source` completo), auto-descobre `_classId`
   vizinhos e testa acesso (200 vs 403) por classe. Não escreve nada.

2. **Enriquecimento flag-gated** — `flattenSydleOneInternationalPaymentRows`
   passa a aflorar os campos complementares do `request` + `ticket` +
   `ticket.openForm` como chaves de topo da linha, reusando as listas de
   candidatos do normalizer (`SYDLE_FIELD_KEYS`) via `findSydleField`. Só
   escalares (string/number) são promovidos. Os campos calculados **sempre
   prevalecem** (enrichment é espalhado antes). Controlado por
   `SYDLE_ONE_ENRICH_FIELDS` (**default `false`** → comportamento idêntico ao
   de hoje, zero regressão no deploy).
   - **Sem migration**: as colunas já existem.
   - **Sem nova chamada de classe**: lê do payload já buscado (os campos
     complementares não estão nos `excludes` do `_search`, então já chegam — ao
     contrário de `*bank*`/`*pix*`, que são excluídos por privacidade).
   - **Ganho automático no matching**: `matchProcess` já pondera
     `purchase_order`/`proforma_number`/`invoice_number`/`supplier_name`; populá-las
     melhora a conciliação automática.

## Árvore de decisão a partir do resultado do probe

Rode o probe onde as credenciais existem (servidor de produção, onde o `.env` é
gerado do SOPS):

```bash
cd /caminho/do/importacao && node scripts/sydle-class-discovery.mjs
```

Leia o bloco "Veredicto", a seção "Acesso de leitura por classe" e o JSON em
`scripts/out/sydle-discovery-<ts>.json`. Então:

### Caso A — campos já vêm no payload (seção `fieldGapAnalysis` mostra `[OK]`)

O dado está no request/ticket, só não era promovido.

1. Confira se os **nomes reais** dos campos estão nas listas de
   `SYDLE_FIELD_KEYS` (normalizer.ts). Se o probe revelar um nome novo
   (ex.: `nomeExportador`), **adicione-o** à lista correspondente.
2. Ligue a flag **em staging**: `SYDLE_ONE_ENRICH_FIELDS=true`.
3. Rode um `sync-now` manual e valide os valores na tela
   `/importacao/compras-pagamentos` (drawer "abrir a compra") contra a SYDLE.
4. Aprovado pelo financeiro → habilitar em produção.

### Caso B — dado está numa classe vizinha legível (status 200 no probe)

Ex.: fornecedor numa classe própria referenciada por `{_id, _classId}`.

1. Adicione a busca da classe em `client.ts` (espelhe `lookupSydleOneByIds`):
   colete os `_id` referenciados, faça `_search` com `_source.includes` mínimo,
   monte um `Map`, e injete no `flattenSydleOneInternationalPaymentRows`
   (como `ticketById`/`currencyById` já fazem).
2. Exponha o(s) campo(s) na linha e/ou em `SYDLE_FIELD_KEYS`.
3. Considere uma migration **só** se quiser coluna nova indexada (a maioria já
   tem coluna). Caso contrário, reuse a coluna existente.
4. Valide em staging como no Caso A.

### Caso C — 403 (forms `InternationalPaymentOpenForm` / `RequestData`)

Não há solução client-side. Ação **externa** com a SYDLE:

- Pedir permissão de leitura (read-only) à `SYDLE_USER` sobre a classe/form, **ou**
- Pedir uma **view/API consolidada** expondo os campos com permissão de leitura.
  Documente o que ficou faltando e mantenha as colunas nulas até a liberação.

## Campos-alvo e colunas de destino

| Campo           | Coluna            | Usado no matching?                                                                 |
| --------------- | ----------------- | ---------------------------------------------------------------------------------- |
| Fornecedor      | `supplier_name`   | sim (+0.2)                                                                         |
| Proforma / PI   | `proforma_number` | sim (+0.45)                                                                        |
| Invoice / CI    | `invoice_number`  | sim (+0.45)                                                                        |
| Pedido / PO     | `purchase_order`  | sim (+0.45)                                                                        |
| Código processo | `process_code`    | sim (match exato)                                                                  |
| Câmbio          | `exchange_rate`   | não (relatório)                                                                    |
| Valor BRL       | `amount_brl`      | não (relatório)                                                                    |
| Contrato câmbio | `contract_number` | não (relatório)                                                                    |
| Remessa/SWIFT   | `remittance_id`   | não (relatório)                                                                    |
| Banco           | `bank_name`       | não — **excluído** no `_search` por privacidade; só promover com decisão explícita |

## Flags / variáveis de ambiente

| Var                       | Default | Efeito                                                           |
| ------------------------- | ------- | ---------------------------------------------------------------- |
| `SYDLE_SYNC_ENABLED`      | `false` | liga o job de sincronização                                      |
| `SYDLE_ONE_ENRICH_FIELDS` | `false` | liga o enriquecimento de campos complementares (Fase 2)          |
| `ALLOW_SYDLE_SYNC_DEPLOY` | —       | exigido por `scripts/deploy.sh` quando `SYDLE_SYNC_ENABLED=true` |

## Segurança (P0 ainda aberto)

O `signIn` da SYDLE One só aceita **GET com login/senha na query string**
(POST → 405). A URL pode vazar em logs de proxy/WAF. O probe **nunca imprime a
senha** e redige a query string. Mitigação completa depende da SYDLE (token/header/POST).
Até lá: restringir/limpar logs de acesso e **rotacionar `SYDLE_PASSWORD`** após
rodar o probe. Ver `docs/KNOWN_ISSUES.md`.

## Rollout (resumo)

1. Rodar o probe em produção (read-only) → coletar veredito.
2. Aplicar Caso A/B/C conforme o resultado.
3. `SYDLE_ONE_ENRICH_FIELDS=true` **em staging**, `sync-now`, validar drawer.
4. Aprovação do financeiro → habilitar em produção (deploy com
   `ALLOW_SYDLE_SYNC_DEPLOY=1`).
5. Rotacionar `SYDLE_PASSWORD`.
