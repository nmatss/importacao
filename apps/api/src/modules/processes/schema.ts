import { z } from 'zod';

const decimalPattern = /^(?:0|[1-9]\d*)(?:[.,]\d{1,4})?$/;

const nonNegativeDecimalString = (label: string) =>
  z.preprocess(
    (value) => (value === '' || value == null ? undefined : value),
    z
      .union([z.string(), z.number()])
      .transform(String)
      .refine((value) => decimalPattern.test(value), `${label} deve ser zero ou positivo`)
      .optional(),
  );

function validateProcessDates(
  data: { etd?: string; eta?: string; shipmentDate?: string },
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
    containerType: z.string().max(100).optional(),
    totalFobValue: nonNegativeDecimalString('Valor FOB'),
    freightValue: nonNegativeDecimalString('Valor de frete'),
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
    status: z
      .enum([
        'draft',
        'documents_received',
        'validating',
        'validated',
        'espelho_generated',
        'sent_to_fenicia',
        'li_pending',
        'completed',
        'cancelled',
      ])
      .optional(),
    incoterm: z.string().max(20).optional(),
    portOfLoading: z.string().max(200).optional(),
    portOfDischarge: z.string().max(200).optional(),
    etd: z.string().max(30).optional(),
    eta: z.string().max(30).optional(),
    shipmentDate: z.string().max(30).optional(),
    totalFobValue: nonNegativeDecimalString('Valor FOB'),
    freightValue: nonNegativeDecimalString('Valor de frete'),
    totalBoxes: z.coerce.number().int().min(0).optional(),
    totalNetWeight: nonNegativeDecimalString('Peso líquido'),
    totalGrossWeight: nonNegativeDecimalString('Peso bruto'),
    totalCbm: nonNegativeDecimalString('CBM'),
    exporterName: z.string().max(500).optional(),
    exporterAddress: z.string().max(1000).optional(),
    importerName: z.string().max(500).optional(),
    importerAddress: z.string().max(1000).optional(),
    hasLiItems: z.boolean().optional(),
    hasCertification: z.boolean().optional(),
    hasFreeOfCharge: z.boolean().optional(),
    notes: z.string().max(5000).optional(),
    containerType: z.string().max(100).optional(),
  })
  .superRefine(validateProcessDates);

export const processFilterSchema = z.object({
  status: z.string().max(50).optional(),
  brand: z.string().max(50).optional(),
  search: z.string().max(200).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).default(20),
});

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

export type CreateProcessInput = z.infer<typeof createProcessSchema>;
export type UpdateProcessInput = z.infer<typeof updateProcessSchema>;
export type ProcessFilter = z.infer<typeof processFilterSchema>;
