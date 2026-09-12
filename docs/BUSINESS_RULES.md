# Business Rules

Ultima atualizacao: 2026-06-19

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
- Documento com confianca abaixo de 40% fica armazenado como evidencia, mas nao
  e utilizavel automaticamente para card, comparativo, validacao final ou
  espelho automatico.
- Delete de documento deve preservar historico de extracao com metadados
  suficientes para auditoria posterior.
- O marco `documents_received` considera Invoice + Packing List + OHBL ou Draft
  BL presentes.

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
- Validacao parcial e somente diagnostica; nao promove processo, nao abre fluxo
  final de correcao, nao move pasta e nao gera rascunho KIOM.
- Validacao final exige `document-set-completeness` aprovado: Invoice, Packing
  List e OHBL/Draft BL utilizaveis.
- Cada validacao final deve gerar `validation_runs` canonico e vincular
  resultados, historico e correcao ao run na mesma transacao de persistencia.
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

## Alertas De Processo Sem Movimentacao

- "Parado" e condicao calculada na leitura, nunca evento persistido por processo.
- Nao entram: processo `completed`/`cancelled`, travado (`locked_at`), ja
  registrado (`registered_at` ou `customs_clearance_at`) e em transito
  (ETA maior ou igual a hoje no fuso America/Sao_Paulo).
- Entram: ETA passada sem registro (a partir de 1 dia util) e processo sem ETA
  parado ha 3 dias uteis ou mais.
- Teto: processo em transito sem nenhuma atualizacao ha 30 dias uteis volta a
  aparecer, porque a ETA pode estar errada para frente.
- Escalada: 10 dias uteis apos a ETA sem registro o aviso vira `critical`.
- Cadencia: UMA mensagem por dia util, com todos os processos; cada processo
  reaparece no maximo a cada 5 dias uteis, salvo escalada. Sem mensagem em
  sabado e domingo. Dia util = segunda a sexta; feriados nao sao considerados
  nesta versao.
- O estado da cadencia mora na propria mensagem gravada em `alerts` (linha
  `Processos: ...`), por isso a regra nao exige migration.
- DEPENDENCIA: a regra le `eta` e `registered_at` do banco do sistema. Enquanto
  o sync da Follow Up (`FOLLOW_UP_SYNC_MODE=apply`) nao rodar, essas colunas sao
  um retrato de 25/08 — processo ja registrado na planilha continua elegivel, e
  ETA errada para frente silencia por ate 30 dias uteis.

Evidencias:

- `apps/api/src/jobs/stalled-process.ts`
- `apps/api/src/shared/utils/dates.ts` (`businessDaysBetween`, `isBusinessDay`)
- `apps/api/src/jobs/__tests__/stalled-process.test.ts`

## Mensagens No Google Chat

- Ha um unico caminho de entrega: `modules/alerts/delivery.service.ts`. Nenhum
  outro modulo pode chamar `sendToGoogleChat` (guarda estatica em
  `modules/alerts/__tests__/caminho-unico-de-chat.test.ts`).
- Alerta de alteracao (falhas de validacao) repete apenas quando o conjunto de
  falhas muda; reprocessar o mesmo documento nao gera mensagem nova.
- Alerta de agregacao diaria deduplica por dia civil do operador e nao e
  reentregue depois que o dia vira.
- Mensagens de um mesmo processo caem no mesmo topico do espaco; mensagens sem
  processo agrupam por titulo e semana.
- Texto de alerta e sempre em portugues, sem nome tecnico de verificacao.
