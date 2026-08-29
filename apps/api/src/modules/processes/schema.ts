import { z } from 'zod';
import { canonicalizeRecordType } from './constants.js';
import {
  isoDateSchema,
  refineDateRange,
  dateRangeRefinement,
} from '../../shared/schemas/iso-date.js';

const decimalPattern = /^(?:0|[1-9]\d*)(?:[.,]\d{1,6})?$/;

const decimalStringValue = (label: string, max?: number) =>
  z
    .union([z.string(), z.number()])
    .transform(String)
    .refine((value) => decimalPattern.test(value), `${label} deve ser zero ou positivo`)
    // Postgres numeric só aceita ponto decimal; entrada pt-BR usa vírgula.
    .transform((value) => value.replace(',', '.'))
    .refine(
      (value) => max === undefined || Number(value) <= max,
      `${label} acima do limite permitido`,
    );

const nonNegativeDecimalString = (label: string, max?: number) =>
  z.preprocess(
    (value) => (value === '' || value == null ? undefined : value),
    decimalStringValue(label, max).optional(),
  );

/**
 * Variante para o PUT: `null` explícito significa "apagar o valor" e precisa
 * chegar ao service. O `nonNegativeDecimalString` colapsa `null` em `undefined`
 * no preprocess, e a chave some do patch — a tela respondia "Processo
 * atualizado com sucesso" com o dado errado ainda no banco. String vazia
 * continua sendo descarte, como antes.
 */
const nullableDecimalString = (label: string, max?: number) =>
  z.preprocess(
    (value) => (value === '' ? undefined : value),
    decimalStringValue(label, max).nullable().optional(),
  );

// Limites derivados da precisão das colunas numeric correspondentes.
const REGISTRATION_DOLLAR_MAX = 9999.999999; // numeric(10,6)
const CUSTOMS_VALUE_MAX = 999_999_999_999.99; // numeric(14,2)
const INSURANCE_VALUE_MAX = 9_999_999_999.99; // numeric(12,2)
const OPERATIONAL_AMOUNT_MAX = 9_999_999_999.99; // numeric(12,2)

// As guardas por truthiness sao intencionais: com `null` ("apagar o campo") ou
// com o campo ausente nao ha o que cruzar, entao a comparacao e simplesmente
// pulada em vez de reprovar o payload.
function validateProcessDates(
  data: {
    etd?: string | null;
    eta?: string | null;
    shipmentDate?: string | null;
  },
  ctx: z.RefinementCtx,
) {
  if (data.etd && data.eta && data.eta < data.etd) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['eta'],
      message: 'ETA não pode ser anterior ao ETD',
    });
  }
  if (data.shipmentDate && data.eta && data.shipmentDate > data.eta) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['shipmentDate'],
      message: 'Data de embarque não pode ser posterior ao ETA',
    });
  }
}

export const createProcessSchema = z
  .object({
    processCode: z.string().min(1, 'Código do processo obrigatório').max(50),
    brand: z.enum(['puket', 'imaginarium']),
    incoterm: z.string().max(20).default('FOB'),
    portOfLoading: z.string().max(200).optional(),
    portOfDischarge: z.string().max(200).optional(),
    etd: z.string().max(30).optional(),
    eta: z.string().max(30).optional(),
    exporterName: z.string().max(500).optional(),
    exporterAddress: z.string().max(1000).optional(),
    importerName: z.string().max(500).optional(),
    importerAddress: z.string().max(1000).optional(),
    notes: z.string().max(5000).optional(),
    urgentNote: z.string().max(2000).nullable().optional(),
    containerType: z.string().max(100).optional(),
    totalFobValue: nonNegativeDecimalString('Valor FOB'),
    freightValue: nonNegativeDecimalString('Valor de frete'),
    insuranceValue: nonNegativeDecimalString('Seguro', INSURANCE_VALUE_MAX),
    customsValue: nonNegativeDecimalString('Valor aduaneiro', CUSTOMS_VALUE_MAX),
    registrationDollar: nonNegativeDecimalString('Dólar de registro', REGISTRATION_DOLLAR_MAX),
    totalCbm: nonNegativeDecimalString('CBM'),
    totalBoxes: z.coerce.number().int().min(0).optional(),
    totalNetWeight: nonNegativeDecimalString('Peso líquido'),
    totalGrossWeight: nonNegativeDecimalString('Peso bruto'),
    shipmentDate: z.string().max(30).optional(),
  })
  .superRefine(validateProcessDates);

export const createFromPreConsSchema = z.object({
  processCode: z.string().min(1).max(50),
  brand: z.enum(['puket', 'imaginarium']),
  preConsCode: z.string().max(100).optional(),
  etd: z.string().max(30).optional(),
  eta: z.string().max(30).optional(),
  notes: z.string().max(5000).optional(),
});
export type CreateFromPreConsInput = z.infer<typeof createFromPreConsSchema>;

export const renameProcessSchema = z.object({
  newProcessCode: z.string().min(1).max(50),
  reason: z.string().max(500).optional(),
});
export type RenameProcessInput = z.infer<typeof renameProcessSchema>;

export const lockProcessSchema = z.object({
  reason: z.string().max(50).default('manual'),
});
export type LockProcessInput = z.infer<typeof lockProcessSchema>;

export const updateProcessSchema = z
  .object({
    processCode: z.string().min(1).max(50).optional(),
    brand: z.enum(['puket', 'imaginarium']).optional(),
    // `status` NAO entra aqui de proposito: `update()` escreve o patch direto,
    // sem `assertTransition` e sem gravar o evento `status_changed`, entao um
    // PUT levava o processo de `draft` a `completed` num salto, burlando a
    // maquina de estados e a trilha. Mudanca de status so por
    // `PATCH /:id/status`.
    incoterm: z.string().max(20).nullable().optional(),
    portOfLoading: z.string().max(200).nullable().optional(),
    portOfDischarge: z.string().max(200).nullable().optional(),
    etd: z.string().max(30).nullable().optional(),
    eta: z.string().max(30).nullable().optional(),
    shipmentDate: z.string().max(30).nullable().optional(),
    totalFobValue: nullableDecimalString('Valor FOB'),
    freightValue: nullableDecimalString('Valor de frete'),
    totalBoxes: z.coerce.number().int().min(0).nullable().optional(),
    totalNetWeight: nullableDecimalString('Peso líquido'),
    totalGrossWeight: nullableDecimalString('Peso bruto'),
    totalCbm: nullableDecimalString('CBM'),
    exporterName: z.string().max(500).nullable().optional(),
    exporterAddress: z.string().max(1000).nullable().optional(),
    importerName: z.string().max(500).nullable().optional(),
    importerAddress: z.string().max(1000).nullable().optional(),
    hasLiItems: z.boolean().optional(),
    hasCertification: z.boolean().optional(),
    hasFreeOfCharge: z.boolean().optional(),
    notes: z.string().max(5000).nullable().optional(),
    urgentNote: z.string().max(2000).nullable().optional(),
    containerType: z.string().max(100).nullable().optional(),
    insuranceValue: nullableDecimalString('Seguro', INSURANCE_VALUE_MAX),
    customsValue: nullableDecimalString('Valor aduaneiro', CUSTOMS_VALUE_MAX),
    registrationDollar: nullableDecimalString('Dólar de registro', REGISTRATION_DOLLAR_MAX),
    duimpNumber: z.string().max(100).nullable().optional(),
    registeredAt: z.string().max(30).nullable().optional(),
    customsChannel: z.string().max(20).nullable().optional(),
    customsClearanceAt: z.string().max(30).nullable().optional(),
  })
  .superRefine(validateProcessDates);

export const processFilterSchema = z
  .object({
    status: z.string().max(50).optional(),
    brand: z.string().max(50).optional(),
    search: z.string().max(200).optional(),
    // Antes eram `z.string()` livre: `?endDate=abc` chegava ao service, `new
    // Date('abc').toISOString()` estourava e o operador recebia HTTP 400 com a
    // mensagem interna em ingles "Invalid time value".
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine(refineDateRange, dateRangeRefinement);

/**
 * Motivo obrigatorio nas transicoes de REABERTURA (ver REOPEN_TRANSITIONS na
 * state machine). O tamanho minimo existe para nao aceitar "ok"/"." como
 * justificativa de reabrir um processo ja concluido.
 *
 * A PRESENCA nao da para exigir aqui: depende do status ATUAL do processo, que
 * o schema nao ve — `validating` tambem e destino normal de `validated`. Entao o
 * Zod congela o formato e `processService` reaplica este mesmo schema quando
 * descobre que a transicao e de reabertura.
 */
export const REOPEN_REASON_MIN_LENGTH = 10;

export const reopenReasonSchema = z
  .string()
  .trim()
  .min(REOPEN_REASON_MIN_LENGTH, `Motivo deve ter ao menos ${REOPEN_REASON_MIN_LENGTH} caracteres`)
  .max(500);

export const updateStatusSchema = z.object({
  status: z.enum([
    'draft',
    'documents_received',
    'validating',
    'validated',
    'espelho_generated',
    'sent_to_fenicia',
    'li_pending',
    'completed',
    'cancelled',
  ]),
  reason: reopenReasonSchema.optional(),
});

export const VALID_LOGISTIC_STATUSES = [
  'consolidation',
  'waiting_shipment',
  'in_transit',
  'berthing',
  'registered',
  'customs_inspection',
  'port_release',
  'waiting_loading',
  'traveling_cd',
  'waiting_entry',
  'internalized',
] as const;

export const updateLogisticStatusSchema = z.object({
  logisticStatus: z.enum(VALID_LOGISTIC_STATUSES),
});

export const createCustomStageSchema = z.object({
  label: z.string().trim().min(1, 'Nome da etapa obrigatorio').max(160),
  position: z.coerce.number().int().min(0).max(1000).default(0),
  completedAt: z.string().max(30).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const updateCustomStageSchema = createCustomStageSchema.partial();

export const createOperationalRecordSchema = z.object({
  recordKind: z.enum(['document_error', 'extra_cost']),
  // Campo livre por design (ver constants.ts); o transform apenas unifica a
  // grafia dos tipos catalogados para que agreguem como um so no relatorio.
  recordType: z
    .string()
    .trim()
    .min(1, 'Tipo obrigatorio')
    .max(160)
    .transform(canonicalizeRecordType),
  quantity: z.coerce.number().int().min(0).nullable().optional(),
  amount: nonNegativeDecimalString('Valor', OPERATIONAL_AMOUNT_MAX),
  currency: z.string().trim().max(10).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const updateOperationalRecordSchema = createOperationalRecordSchema.partial();

export const DRAFT_BL_CHECK_KEYS = [
  'draftReceivedOk',
  'exporterOk',
  'consigneeOk',
  'descriptionOk',
  'referenceOk',
  'ncmsOk',
  'woodOk',
  'freeTimeOk',
  'weightCbmOk',
  'freightOk',
  'containersOk',
] as const;

export const updateDraftBlChecklistSchema = z.object({
  key: z.enum(DRAFT_BL_CHECK_KEYS),
  checked: z.boolean(),
});

export type CreateProcessInput = z.infer<typeof createProcessSchema>;
export type UpdateProcessInput = z.infer<typeof updateProcessSchema>;
export type ProcessFilter = z.infer<typeof processFilterSchema>;
export type CreateCustomStageInput = z.infer<typeof createCustomStageSchema>;
export type UpdateCustomStageInput = z.infer<typeof updateCustomStageSchema>;
export type CreateOperationalRecordInput = z.infer<typeof createOperationalRecordSchema>;
export type UpdateOperationalRecordInput = z.infer<typeof updateOperationalRecordSchema>;
export type UpdateDraftBlChecklistInput = z.infer<typeof updateDraftBlChecklistSchema>;
