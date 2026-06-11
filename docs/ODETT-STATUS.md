# Status da entrega — UAT Odett + Camada de Confiança da IA

**Data:** 2026-05-29 · **PR:** [#58](https://github.com/nmatss/importacao/pull/58) (**merged em 2026-06-11**) · **EM PRODUÇÃO desde 2026-06-11** (SHA `96a695c`, migrations 0011→0015 aplicadas, health verde)

Verificação: `tsc --noEmit` limpo (api+web) · **344 testes api + 26 web + 86 cert-api** verdes · `npm audit --audit-level=high` limpo · CI todo verde incluindo CodeQL · lint 0 warnings (gate `--max-warnings=0` agora bloqueante).

> **Adições de 2026-06-11 no mesmo PR:** cadastro de certificado + escrita gated no Linx (`docs/CERT-LINX-WRITE.md`); hardening (CI sem `|| true`, SMTP TLS, login fail-closed); **Parte A**: motor financeiro (`modules/financial/`, job 08:30 com alertas Invoice<US$20k / Seguro>US$150k / demurrage), historização de validações e extrações (migration `0015`), espelho com join por EAN + Base EAN Puket (layout XLSX inalterado). Detalhe no `CHANGELOG.md` e status por item no `REVISAO-100.md`.

## 1. Os 10 pontos da UAT (processo IM0712602NB)

| #   | Ponto                                | Status                            | Fix                                                                                                                                                                       | Teste                     |
| --- | ------------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| 1   | PIs/itens viravam código de processo | ✅ resolvido                      | regex restrito ao formato Uni.co + `isStrongUnicoCode` + código da IA passa pelo mesmo filtro + guarda de ambiguidade no fuzzy                                            | `processor-codes.test.ts` |
| 2   | "BL emitido" mostrava data de upload | ✅ resolvido                      | campo `issueDate` (emissão real) no schema+prompt; UI com rótulo honesto                                                                                                  | typecheck                 |
| 3   | Descrição da carga cortada           | ✅ resolvido                      | `ExpandableCargoText` ("ver mais") nas seções C, D e E                                                                                                                    | —                         |
| 4   | Madeira não vista no BL Final        | ✅ resolvido                      | `woodDeclaration`/`ncmList` no schema+prompt do BL Final + destaque na UI (priority do `ohbl`)                                                                            | —                         |
| 5   | Pre-Cons não trazida                 | 🟡 parser ✅ / sync aguarda input | parser validado contra a planilha real (3167 linhas, **7 do IM0712602NB**); sync agendada no scheduler + delete transacional; **falta `GOOGLE_DRIVE_PRE_CONS_FOLDER_ID`** | `parse-precons.test.ts`   |
| 6   | Docs vêm do email ou drive?          | ✅ respondido                     | do **e-mail** (Drive é backup); `getSource()` rotula a origem                                                                                                             | —                         |
| 7   | INV não lida (causa-raiz)            | ✅ resolvido                      | schema alinhado ao prompt (`exporterTaxId`/`importerCnpj`/`isFreeOfCharge`) + classificação por conteúdo + gate degradável + `hasRelevantData` (fim do `Boolean({})`)     | suíte validation          |
| 8   | PL misturava qtd × faturamento       | ✅ resolvido                      | regra anti-mistura no prompt + check numérico (quantidade deve ser inteira)                                                                                               | `harness.test.ts`         |
| 9   | Checklist poluída                    | ✅ resolvido                      | status `skipped` em 14 checks dependentes de INV + UI colapsável                                                                                                          | suíte validation          |
| 10  | "Resolver manualmente" sem trava     | ✅ resolvido                      | justificativa obrigatória + nota gravada + auditoria + recompute de status + migration `0014` no deploy                                                                   | typecheck                 |

## 2. Camada de confiança da IA (skills + harness dentro da API)

Detalhe completo em [`AI-HARNESS.md`](./AI-HARNESS.md).

- **100% Vertex AI** — toda análise por IA passa pelo provider (sem bypass); `cert-api` não usa IA; teto R$150/mês.
- **Harness pós-extração** (`ai/harness/`): grounding anti-alucinação, formato (NCM, container ISO 6346 com check-digit, CNPJ com dígito verificador, USD), consistência numérica, validação contra a KB. Achado-erro rebaixa a confiança e força revisão humana. `_trust` não vaza para validação/UI.
- **Skills** (`ai/skills/`): cada documento = schema + receita de verificação.
- **Base de Conhecimento** (`ai/knowledge/`): 360 NCMs, portos, 559 fornecedores, tarifas, EAN Puket — copiada para `dist/` no build.

## 3. Processo de garantia

- **Revisão 100%** (14 agentes) → gap analysis em [`REVISAO-100.md`](./REVISAO-100.md).
- **Revisão adversarial 10×** (16 agentes) que tentou refutar cada ponto — achou furos reais (deploy-breakers + lógica), **todos corrigidos** (KB→dist, arquivos rastreados, `Boolean({})`, gate do código da IA, quantidade decimal, vuln HIGH `tmp` no CI).

## 4. Pendente após o deploy de 2026-06-11 — ações de negócio/infra

1. ~~Deploy~~ ✅ **feito em 2026-06-11** — migrations automáticas no `deploy.sh` (passo 4.5); `.env` de produção já tem `GOOGLE_VERTEX_PROJECT/LOCATION`, `AI_MONTHLY_BUDGET_USD=26` e `GOOGLE_DRIVE_PRE_CONS_FOLDER_ID`.
2. **Ligar o Vertex** (privacidade): a SA `n8n-automacao@n8n-grupo-unico` recebeu **403** no teste real (`aiplatform.endpoints.predict`) — falta, no Console GCP do projeto `n8n-grupo-unico`: (a) habilitar `aiplatform.googleapis.com`, (b) conceder `roles/aiplatform.user` à SA, (c) descomentar `AI_PROVIDER=vertex` no `.env` do servidor e reiniciar a api. Até lá a extração segue no OpenRouter.
3. **Pre-Cons**: pasta criada no Drive — **"Pre-Cons (sync portal importação)"** (`1OJmEV1GTI7vC0B-Uxb-btgQRMDu0530B`). Falta **compartilhar com a SA** `n8n-automacao@n8n-grupo-unico.iam.gserviceaccount.com` (leitor) e o time passar a soltar as Pre-Cons semanais lá (cron de 6h já agendado em produção).
4. **Linx (certificados)**: rodar a descoberta — `docker exec importacao-cert-api python scripts/linx_discovery.py puket [SKU]` e `… imaginarium` — preencher `LINX_PROP_COL_*`/`LINX_PRODUTO_COL_SKU` e ligar `LINX_WRITE_ENABLED=true`.
5. **Dados a plugar**: EAN Imaginarium (aba `#REF!` na origem), tarifa diária de demurrage por terminal (Premissas), câmbio em `currency_exchanges` (motor financeiro converte para BRL só com taxa), CNPJs dos importadores.
6. **Itens maiores restantes**: layout do espelho ancorado em EAN (alinhar com a Odett antes de mudar o XLSX), `NODE_ENV=development` no servidor (corrigir para `production` em janela controlada), TLS no compose, SOPS (age key).
