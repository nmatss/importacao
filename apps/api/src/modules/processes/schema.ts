import { z } from 'zod';

export const createProcessSchema = z.object({
  processCode: z.string().min(1, 'Código do processo obrigatório'),
  brand: z.enum(['puket', 'imaginarium']),
  incoterm: z.string().default('FOB'),
  portOfLoading: z.string().optional(),
  portOfDischarge: z.string().optional(),
  etd: z.string().optional(),
  eta: z.string().optional(),
  exporterName: z.string().optional(),
  exporterAddress: z.string().optional(),
  importerName: z.string().optional(),
  importerAddress: z.string().optional(),
  notes: z.string().optional(),
});

export const updateProcessSchema = z.object({
  processCode: z.string().min(1).optional(),
  brand: z.enum(['puket', 'imaginarium']).optional(),
  status: z.enum([
    'draft', 'documents_received', 'validating', 'validated',
    'espelho_generated', 'sent_to_fenicia', 'li_pending', 'completed', 'cancelled'
  ]).optional(),
  incoterm: z.string().optional(),
  portOfLoading: z.string().optional(),
  portOfDischarge: z.string().optional(),
  etd: z.string().optional(),
  eta: z.string().optional(),
  shipmentDate: z.string().optional(),
  totalFobValue: z.string().optional(),
  freightValue: z.string().optional(),
  totalBoxes: z.number().optional(),
  totalNetWeight: z.string().optional(),
  totalGrossWeight: z.string().optional(),
  totalCbm: z.string().optional(),
  exporterName: z.string().optional(),
  exporterAddress: z.string().optional(),
  importerName: z.string().optional(),
  importerAddress: z.string().optional(),
  hasLiItems: z.boolean().optional(),
  hasCertification: z.boolean().optional(),
  hasFreeOfCharge: z.boolean().optional(),
  notes: z.string().optional(),
});

export const processFilterSchema = z.object({
  status: z.string().optional(),
  brand: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().default(1),
  limit: z.coerce.number().default(20),
});

export type CreateProcessInput = z.infer<typeof createProcessSchema>;
export type UpdateProcessInput = z.infer<typeof updateProcessSchema>;
export type ProcessFilter = z.infer<typeof processFilterSchema>;
