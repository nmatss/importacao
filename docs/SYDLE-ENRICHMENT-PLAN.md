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

2. **Enriquecimento por campo (Caso A) flag-gated** —
   `flattenSydleOneInternationalPaymentRows` passa a aflorar os campos
   complementares do `request` + `ticket` + `ticket.openForm` como chaves de topo
   da linha, reusando as listas de candidatos do normalizer (`SYDLE_FIELD_KEYS`)
   via `findSydleField`. Só escalares (string/number) são promovidos. Os campos
   calculados **sempre prevalecem** (enrichment é espalhado antes). Controlado por
   `SYDLE_ONE_ENRICH_FIELDS` (**default `false`** → comportamento idêntico ao de
   hoje, zero regressão no deploy).
   - **Sem migration**: as colunas já existem.
   - **Sem nova chamada de classe**: lê do payload já buscado (os campos
     complementares não estão nos `excludes` do `_search`, então já chegam — ao
     contrário de `*bank*`/`*pix*`, que são excluídos por privacidade).
   - **Ganho automático no matching**: `matchProcess` já pondera
     `purchase_order`/`proforma_number`/`invoice_number`/`supplier_name`; populá-las
     melhora a conciliação automática.

3. **Resolvedor de classe vizinha (Caso B) — já pré-codado** — mecanismo
   genérico e config-driven em `client.ts`:
   `SydleClient.resolveEnrichmentClasses` coleta os `_id` referenciados (no
   request ou no ticket), busca a classe vizinha em lote (reusa
   `lookupSydleOneByIds`, então 403 vira `failures` sem derrubar o sync) e
   `applyEnrichmentClasses` mapeia os campos resolvidos nas colunas. Também
   gated por `SYDLE_ONE_ENRICH_FIELDS`. **Inerte por padrão**: a lista
   `SYDLE_ENRICHMENT_CLASSES` está vazia → nenhum fetch extra. A classe vizinha
   resolvida **prevalece** sobre o enriquecimento por campo (entidade > texto livre).

## Resultado do probe (executado em produção 2026-06-20)

Rodado dentro do container `importacao-api` em `192.168.168.124` (host sem node;
container tem node v22 + env SYDLE). Instância: `grupounico.sydle.one`, app `main`.
Amostra de 3 registros, **120 campos** distintos no payload da classe de pagamentos.

**Onde os campos realmente estão** (a maior parte sob `requestData`, o form):

| Campo                                              | Origem real                                                                      | Caso       | Acesso  |
| -------------------------------------------------- | -------------------------------------------------------------------------------- | ---------- | ------- |
| Código do processo                                 | `requestData.processCode`                                                        | A (inline) | 200     |
| Invoice / CI                                       | `requestData.invoiceCode`                                                        | A (inline) | 200     |
| Marca                                              | `requestData.brand` → classe `685179c1…` → `name`                                | B (1-hop)  | 200     |
| Fornecedor                                         | `requestData.recipient` → `689cd3bd…` → `enterprise` → `591365fe…` → `legalName` | B (2-hop)  | 200     |
| Proforma/PI, câmbio, BRL, banco, contrato, remessa | não estão no payload; provavelmente nas classes `68bf…5efb` / `64f22b57…`        | C          | **403** |

Classes legíveis (200): pagamentos, ticket, ticket_status, currency, brand,
recipient, enterprise (+ genéricas de sistema). Bloqueadas (403): `68bf…5efb`,
`64f22b57e85f4a4b92376c43` (forms detalhadas — onde devem estar PI/câmbio/banco).

**Implementado a partir disso** (já nos commits desta rodada, gated por
`SYDLE_ONE_ENRICH_FIELDS`): Caso A passou a buscar dentro de `requestData`
(`invoiceCode` adicionado a `SYDLE_FIELD_KEYS`); Caso B ganhou encadeamento
(2-hop) e `SYDLE_ENRICHMENT_CLASSES` já vem preenchido com **brand** e
**supplier** (recipient→enterprise→legalName), classIds com override por env
(`SYDLE_BRAND_CLASS_ID`, `SYDLE_RECIPIENT_CLASS_ID`, `SYDLE_ENTERPRISE_CLASS_ID`).

Resultado líquido com a flag ligada: **process_code, invoice_number, brand e
supplier_name** passam a ser populados — destravando match exato por processo e
os pesos de invoice (+0.45) e fornecedor (+0.2) no `matchProcess`. Faltam só os
campos atrás do 403 (Caso C).

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
**O mecanismo já está pronto** (não precisa escrever código de fetch). Basta
preencher a constante `SYDLE_ENRICHMENT_CLASSES` em
`apps/api/src/modules/sydle/client.ts` com uma entrada por classe vizinha:

```ts
export const SYDLE_ENRICHMENT_CLASSES: SydleEnrichmentClassSpec[] = [
  {
    label: 'supplier',
    classId: process.env.SYDLE_SUPPLIER_CLASS_ID ?? '', // do probe
    source: 'request', // 'request' (default) ou 'ticket'
    refPath: ['supplier'], // request.supplier._id (caminho confirmado no probe)
    includes: ['name', 'country'],
    map: { name: 'supplierName' }, // campo da classe vizinha -> coluna complementar
  },
];
```

Regras do spec:

- `refPath` aponta para o objeto-referência `{_id}` no `request` (ou `ticket` se
  `source: 'ticket'`). O `_id` é coletado e a classe é buscada em lote.
- `map` liga um campo (dot-path) da classe vizinha a uma coluna complementar da
  linha (que o normalizer reconhece). Só escalares são promovidos.
- 403/erro na classe vira `failures` no metadata, sem derrubar o sync.
- Coluna nova indexada → migration (a maioria já existe; reuse). Senão, sem migration.

Depois: `SYDLE_ONE_ENRICH_FIELDS=true` em staging, `sync-now`, validar drawer.

### Caso C — 403 (classes detalhadas bloqueadas)

Confirmado pelo probe: as classes `68bf1179b042c72f03995efb` e
`64f22b57e85f4a4b92376c43` retornam **403** para a `SYDLE_USER`. São as candidatas
a conter proforma/PI, taxa de câmbio, valor BRL, banco, contrato de câmbio e
remessa (campos ausentes do payload). Não há solução client-side. Ação **externa**:

- Pedir à SYDLE permissão de leitura (read-only) à `SYDLE_USER` sobre essas duas
  classes (IDs acima), **ou** uma view/API consolidada expondo os campos.
- Quando liberar: rode o probe de novo (passarão a 200), descubra o caminho dos
  campos e adicione-os via Caso A (se inline) ou Caso B (se referência).
- Até lá, essas colunas seguem nulas (sem impacto no resto).

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
