/**
 * Catalogo do checklist documental — FONTE UNICA (decisao D7, reuniao 11/09).
 *
 * Antes a lista existia duas vezes: `TRACKING_STEPS`/`TRACKING_STEP_LABELS` em
 * `follow-up/service.ts` (usada no evento do historico) e `CHECKLIST_STEPS` em
 * `apps/web/src/shared/lib/constants.ts` (usada na tela). As duas saiam do
 * lugar: clicar em "Atualizar Follow-up" gravava no historico "Checklist:
 * Enviado para Fenicia feito". Agora o rotulo e um so, servido pela API em
 * `GET /api/processes/:id/checklist`.
 *
 * Rotulo conferido contra `scripts/import-follow-up.js` (mapa COL), que e a
 * verdade do mapeamento coluna da planilha -> coluna do banco:
 *
 * - `sendInvoice: 84`       (CG "Enviar Invoice  Fenicia*") -> invoiceSentFeniciaAt
 * - `collectSignatures: 85` (CH)                            -> signaturesCollectedAt
 * - `sendDocsCopy: 86`      (CI)                            -> signedDocsSentAt
 * - `updateFollowUp: 87`    (CJ "Atualizar Follow-up")      -> sentToFeniciaAt
 *
 * Ou seja: `sentToFeniciaAt` E "Atualizar Follow-up"; quem estava errado era o
 * rotulo da API, nao o da tela.
 *
 * `active: false` retira a etapa da tela e do progresso SEM apagar coluna nem
 * dado (reuniao: "coletar assinaturas nao se faz mais"; "enviar invoice
 * Fenicia" e "enviar docs assinados" sao a mesma coisa, fica uma). Os 95
 * timestamps de `signed_docs_sent_at` e os 36 de `signatures_collected_at` que
 * existem em producao continuam no banco e no historico.
 */
export interface ChecklistCatalogStep {
  /** Chave estavel = coluna de `follow_up_tracking`. Nunca aparece ao usuario. */
  key: string;
  label: string;
  description: string;
  /** Etapa fora da rotina atual: nao aparece na tela nem conta no progresso. */
  active: boolean;
}

export const CHECKLIST_CATALOG = [
  {
    key: 'documentsReceivedAt',
    label: 'Documentos Recebidos',
    description: 'Invoice, Packing List e BL recebidos',
    active: true,
  },
  {
    key: 'preInspectionAt',
    label: 'Pre-conferencia',
    description: 'Verificacao cruzada dos documentos',
    active: true,
  },
  {
    key: 'savedToFolderAt',
    label: 'Salvar na Pasta',
    description: 'Documentos salvos na pasta do processo',
    active: true,
  },
  {
    key: 'ncmVerifiedAt',
    label: 'Conferir NCMs e Descricoes',
    description: 'NCMs, descricoes e atributos conferidos',
    active: true,
  },
  {
    key: 'ncmBlCheckedAt',
    label: 'Conferir NCMs no BL',
    description: 'Todas as NCMs constam no BL',
    active: true,
  },
  {
    key: 'freightBlCheckedAt',
    label: 'Conferir Frete no BL',
    description: 'Valor do frete confere com BL',
    active: true,
  },
  {
    key: 'espelhoBuiltAt',
    label: 'Montar Espelho',
    description: 'Consolidado e espelho do processo montados',
    active: true,
  },
  {
    key: 'invoiceSentFeniciaAt',
    label: 'Enviar Invoice Fenicia',
    description: 'Invoice e documentos assinados enviados para a Fenicia',
    active: true,
  },
  {
    key: 'espelhoGeneratedAt',
    label: 'Espelho Gerado',
    description: 'Espelho gerado no sistema',
    active: true,
  },
  // Inativas (D7): dado e coluna preservados, so saem da rotina atual.
  {
    key: 'signaturesCollectedAt',
    label: 'Coletar Assinaturas',
    description: 'Assinaturas coletadas nos documentos',
    active: false,
  },
  {
    key: 'signedDocsSentAt',
    label: 'Enviar Docs Assinados',
    description: 'Copia dos docs assinados enviada por email',
    active: false,
  },
  {
    key: 'sentToFeniciaAt',
    label: 'Atualizar Follow-up',
    description: 'Planilha Follow-up atualizada',
    active: true,
  },
  {
    key: 'diDraftAt',
    label: 'Rascunho da DI',
    description: 'Rascunho da DI verificado/solicitado',
    active: true,
  },
  {
    key: 'liSubmittedAt',
    label: 'LI Solicitada',
    description: 'Licenca de Importacao solicitada',
    active: true,
  },
  {
    key: 'liApprovedAt',
    label: 'LI Aprovada',
    description: 'Licenca de Importacao deferida',
    active: true,
  },
  // `as const` preserva as chaves como literais: quem indexa
  // `follow_up_tracking` por elas e conferido pelo compilador, sem cast.
] as const satisfies readonly ChecklistCatalogStep[];

/** Chave de etapa padrao. Uniao literal — e tambem coluna de follow_up_tracking. */
export type ChecklistStepKey = (typeof CHECKLIST_CATALOG)[number]['key'];

/** Todas as chaves, inclusive as inativas (o dado antigo continua legivel). */
export const CHECKLIST_STEP_KEYS = CHECKLIST_CATALOG.map((step) => step.key);

/** Etapas da rotina atual: a tela mostra estas e o progresso divide por elas. */
export const ACTIVE_CHECKLIST_STEPS = CHECKLIST_CATALOG.filter((step) => step.active);

export const ACTIVE_CHECKLIST_STEP_KEYS = ACTIVE_CHECKLIST_STEPS.map((step) => step.key);

const STEP_BY_KEY = new Map<string, ChecklistCatalogStep>(
  CHECKLIST_CATALOG.map((step) => [step.key, step]),
);

/** Rotulo da etapa; a chave crua nunca vai para a tela nem para o historico. */
export function checklistStepLabel(key: string): string {
  return STEP_BY_KEY.get(key)?.label ?? key;
}

export function isChecklistStep(key: string): key is ChecklistStepKey {
  return STEP_BY_KEY.has(key);
}

export function isActiveChecklistStep(key: string): boolean {
  return STEP_BY_KEY.get(key)?.active === true;
}
