# Business Rules

Ultima atualizacao: 2026-06-17

## Processo De Importacao

- Processo pertence a uma marca (`puket` ou `imaginarium`).
- Processo possui status controlado por state machine.
- Processo pode nascer manualmente, por Pre-Cons ou por email.
- Follow-up e milestones acompanham etapa operacional.

Evidencias:

- `apps/api/src/shared/database/schema.ts`
- `apps/api/src/shared/state-machine/process-states.ts`
- `docs/REVISAO-IMPORTACAO-WORKFLOW-2026-06-17.md`

## Documentos

Tipos suportados:

- `invoice`
- `proforma_invoice`
- `packing_list`
- `ohbl`
- `draft_bl`
- `espelho`
- `li`
- `certificate`
- `other`

Regras:

- Upload manual e email ingestion devem validar tipo real do arquivo.
- AI/extracao deve gerar dados estruturados e auditaveis.
- Documento com extracao falha nao deve bloquear auto-espelho quando outros documentos confiaveis existem.

## Card Do Processo

Prioridade de dados:

1. Invoice.
2. Espelho.
3. Processo/manual/sistema.

Regras visuais:

- Invoice: verde.
- Espelho: amarelo.
- Processo/manual/sistema: neutro.

Evidencias:

- `apps/web/src/features/processes/components/ProcessInfoCard.tsx`
- `docs/REVISAO-IMPORTACAO-WORKFLOW-2026-06-17.md`

## Validacao

- Checks podem ser `passed`, `failed`, `warning` ou `skipped`.
- `skipped` indica falta de fonte ou bloqueio, nao erro.
- Aceite manual exige justificativa e deve ser auditado.
- Aceite manual suprime pendencia operacional, mas nao altera o dado fonte.
- Email de correcao deve considerar apenas falhas abertas.

Evidencias:

- `apps/api/src/modules/validation/service.ts`
- `apps/web/src/features/validation/ValidationChecklist.tsx`

## FOB, FOC E Descontos

- Total FOB declarado deve bater com itens comerciais.
- FOC, amostra, brinde e desconto identificado nao entram como item comercial.
- Desconto negativo pode reconciliar soma bruta com FOB declarado.
- Caso reconciliado por FOC/desconto, status adequado e `warning` explicativo, nao falha critica.

Evidencias:

- `apps/api/src/modules/validation/checks/fob-calculation.ts`
- `apps/api/src/modules/ai/harness/__tests__/harness.test.ts`

## Portos

- Portos devem ser comparados normalizados por acento, pais e pontuacao comum.
- `NINGBO` e `NINGBO, CHINA` equivalem.
- `ITAPOA` e `ITAPOA, BRAZIL` equivalem.
- Prefixo inseguro nao equivale: `SANTOS` diferente de `SANTOS DUMONT`.
- Ausencia total de descarga deve ser `warning`.

Evidencias:

- `apps/api/src/modules/validation/utils/port-normalize.ts`
- `apps/api/src/modules/validation/checks/ports-match.ts`
