# Status da entrega — UAT Odett + Camada de Confiança da IA

**Data:** 2026-05-29 · **PR:** [#58](https://github.com/nmatss/importacao/pull/58) · **Branch:** `feat/ai-harness-uat-odett`

Verificação: `tsc --noEmit` limpo (api+web) · **289 testes** verdes · `npm audit --audit-level=high` limpo · CI do PR todo verde.

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

## 4. Pendente — depende de input/decisão do negócio

1. **Deploy** (no servidor): `scripts/apply-pending-migrations.sh` + `.env` de produção com `AI_PROVIDER=vertex` e as `GOOGLE_VERTEX_*`.
2. **Dados a plugar** (código pronto): `GOOGLE_DRIVE_PRE_CONS_FOLDER_ID` (pasta do Drive), **EAN Imaginarium** (aba `#REF!` na origem), tarifas/câmbio, CNPJs dos importadores.
3. **Itens maiores de "Parte A"** (decisão de negócio): motor financeiro (numerário/aduaneiro/demurrage), layout do espelho ancorado em EAN, historização de validações.
