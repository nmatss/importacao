import { z } from 'zod';

export const createProcessSchema = z.object({
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
  totalFobValue: z.string().max(50).optional(),
  freightValue: z.string().max(50).optional(),
  totalCbm: z.string().max(50).optional(),
  totalBoxes: z.coerce.number().min(0).optional(),
  totalNetWeight: z.string().max(50).optional(),
  totalGrossWeight: z.string().max(50).optional(),
  shipmentDate: z.string().max(30).optional(),
});

export const updateProcessSchema = z.object({
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
  totalFobValue: z.string().max(50).optional(),
  freightValue: z.string().max(50).optional(),
  totalBoxes: z.number().min(0).optional(),
  totalNetWeight: z.string().max(50).optional(),
  totalGrossWeight: z.string().max(50).optional(),
  totalCbm: z.string().max(50).optional(),
  exporterName: z.string().max(500).optional(),
  exporterAddress: z.string().max(1000).optional(),
  importerName: z.string().max(500).optional(),
  importerAddress: z.string().max(1000).optional(),
  hasLiItems: z.boolean().optional(),
  hasCertification: z.boolean().optional(),
  hasFreeOfCharge: z.boolean().optional(),
  notes: z.string().max(5000).optional(),
  containerType: z.string().max(100).optional(),
});

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
