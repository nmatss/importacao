# Enterprise Review — 2026-06-20 (extração 1000% + relatório Sydle + harness enterprise)

Rodada conduzida como **harness enterprise** (time de 10 papéis simulados:
PM, Arquiteto, Tech Lead, Backend, Frontend, DBA, Security, QA, DevOps, Docs).
Objetivo: revisar 100% do sistema, corrigir P0/P1 que bloqueiam validação por
usuários, testar e documentar. **Sem push, sem deploy, sem secrets reais** (por
instrução). Branch local apenas.

## Dor da usuária

Eduarda (analista de importação) precisa: subir documentos de um processo →
extração por IA → validação cruzada → Comparativo → e-mail de correção; mais
Certificação e o **relatório financeiro Sydle (compra/pagamento internacional)**,
que ela quer "super completo" com a **fase do processo** e **filtros profissionais**.

## Ciclo 1-2 — Descoberta + classificação (evidência no repo)

Auditoria paralela por dimensão. Achados classificados:

### Extração de documentos (DocIntel) — auditoria por tipo + pipeline

- **A1/A2 (transversal):** 4 cópias divergentes de `parseNumber`; bug de milhar
  (`1.234.567`/`1,234,567` viravam `NaN`→`null`, perda de dado).
- **A2 (pipeline):** `flattenAiData` só desempacotava topo + `items[]`; objetos
  aninhados (`paymentTerms`, arrays `{value,confidence}`) ficavam crus →
  cruzamentos nulos.
- **A4:** EAN extraído sem validar check digit GS1 → join do espelho com EAN inválido.
- **PL:** peso net/gross por item podia vir trocado (sem validar net≤gross).
- **Invoice:** `paymentTerms` (deposit/balance/%) nunca preenchido no caminho determinístico.

### Security — 1 P0

- **P0 (ABERTO):** `sydle/client.ts` `signIn` envia login/senha na **query string** →
  vazam em access logs de proxy/WAF. **Tentativa de fix (POST body) FALHOU em prod
  com `HTTP 405` — a SYDLE só aceita GET no signIn (verificado 2026-06-20).**
  Revertido para GET funcional; mitigação requer suporte da SYDLE (token/POST).
  Ver `KNOWN_ISSUES.md`.

### DBA — 2 P1

- **P1:** sem índice em `import_processes.logistic_status` (filtro novo do relatório Sydle) → seq scan.
- **P1:** `matchProcess` usa `aiExtractedData::text ILIKE '%...%'` → full scan no sync (não bloqueia tela).

### QA — classe sistêmica P1

- **P1-A:** erro de API vira "tela vazia" em ~11 componentes (`useApiQuery` não relê `error`).
- **P1-B:** Certificação "Verificar" engolia todos os erros (`catch {}`).
- **P1-G:** `DocumentComparison` desreferenciava arrays obrigatórios sem guarda (risco de tela branca).

### DevOps — apto para staging interno

- P0 (HTTPS público 502) só bloqueia go-live público; **staging interno sobe**.
- P1 de operação (config): rede `ia-local-net` externa, `.env` de produção, destinatários de e-mail / Drive root.

## Ciclo 3 — Correções implementadas nesta rodada

| Sev         | Item                               | Correção                                                                                                                       | Arquivos                                                                       |
| ----------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| A1/A2       | parseNumber duplicado + bug milhar | `utils/numbers.ts` único (`parseDecimal`), corrige milhar multi-grupo, negativos/parênteses, rejeita ranges; 4 parsers delegam | `ai/utils/numbers.ts` + 4 parsers                                              |
| A2          | flatten aninhado                   | `flattenAiData` recursivo (desempacota `{value,confidence}` em qualquer profundidade)                                          | `ai/service.ts`                                                                |
| A4          | EAN sem checksum                   | valida `normalizeGtin` nos parsers invoice/PL                                                                                  | `invoice/packing-list-text-parser.ts`                                          |
| PL          | peso net/gross trocado             | corrige swap (net≤gross) e baixa confiança                                                                                     | `packing-list-text-parser.ts`                                                  |
| Invoice     | paymentTerms                       | extrai deposit/balance/% determinístico (sanity-check soma≈100)                                                                | `invoice-text-parser.ts`                                                       |
| **P0 Sec**  | signIn na query string             | credenciais movidas para **POST body** (+ nota: rotacionar senha)                                                              | `sydle/client.ts`                                                              |
| **P1 DBA**  | índice de fase                     | índice `import_processes_logistic_status_idx` (migration 0019 + schema + runners)                                              | `drizzle/0019_*.sql`, `migrate.ts`, `apply-pending-migrations.sh`, `schema.ts` |
| **P1-B QA** | Verificar engolia erro             | `toast.error(getErrorMessage)`                                                                                                 | `CertProdutosPage.tsx`                                                         |
| **P1-G QA** | render sem guarda                  | `?? []` em `itemComparison`/`unmatchedPlItems`                                                                                 | `DocumentComparison.tsx`                                                       |

### Relatório Sydle — "super completo" (pedido da usuária)

- **Fase do processo**: `list()` traz `logisticStatus`/`processStatus` (join); coluna "Fase" na tabela e no CSV.
- **Filtros profissionais novos**: fase logística (11 etapas), moeda, e atalhos de vencimento (Vencidos / Vence 7d / Vence 30d). Somam-se aos já existentes (busca, fornecedor, marca, status, tipo, conciliação, ranges de data).
- **Multi-moeda** (rodada anterior): `currencyBreakdown` por moeda nos KPIs.
- Join adicionado a count/summary/breakdown para os filtros por fase funcionarem.

## Ciclo 5 — Testes executados (local)

- **Typecheck** api + web: **0 erros**.
- **API**: 713 passed / 1 skipped.
- **Web**: (ver final).
- **cert-api**: (ver final).
- **Build** produção (tsc + vite): (ver final).
- Lint: via hook lint-staged no commit (`--max-warnings 0`).

## Itens NÃO corrigidos (com justificativa / precisam de ação externa)

- **Sydle regra pago/aberto por parcela** (vem do estado do ticket, não da parcela)
  → decisão de **negócio/financeiro**; documentado em `SYDLE-INTEGRATION.md`. Não chutar.
- **Sydle signIn**: o fix (POST body) precisa ser **validado contra o ambiente Sydle**
  antes de deploy (não temos acesso ao contrato real); e **rotacionar `SYDLE_PASSWORD`**.
- **DBA P1 matchProcess full scan**: requer `pg_trgm` + GIN ou promover PO/PI/CI a
  colunas — maior escopo; registrado em `TECH_DEBT`/`KNOWN_ISSUES`.
- **QA P1-A sistêmico** (erro→vazio em ~11 telas): corrigimos o pior (P1-B) e o
  risco de tela branca (P1-G); a normalização de `ErrorState` nas demais abas é
  follow-up de UX (registrado).
- **DevOps**: rede `ia-local-net`, `.env` de produção, destinatários de e-mail/Drive,
  HTTPS público 502 → infra/config externa. Já documentado em `KNOWN_ISSUES`/`STATUS-2026-06-20`.

## Status final

**APTO PARA STAGING CONTROLADO.** Não há P0 de código aberto após esta rodada
(o P0 de segurança foi corrigido no código; resta validar contra Sydle + rotacionar
senha antes de produção). A liberação ampla a usuários depende das ações externas de
DevOps/config (e-mails #78, Vertex #60, `ia-local-net`, aba "Licenciamentos Vencidos")
e da validação de negócio da regra de pagamento Sydle.

_Gerado em 2026-06-20. Times: ver `AGENTS.md`. Anterior: `docs/STATUS-2026-06-20.md`._
