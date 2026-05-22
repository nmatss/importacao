import { z } from 'zod';

const confidenceField = <T extends z.ZodTypeAny>(valueSchema: T) =>
  z.object({
    value: valueSchema.nullable(),
    confidence: z.number().min(0).max(1),
  });

const espelhoItemSchema = z.object({
  codigo: confidenceField(z.string()),
  descricao: confidenceField(z.string()),
  ncm: confidenceField(z.string()).optional(),
  qty: confidenceField(z.number()).optional(),
  unitPrice: confidenceField(z.number()).optional(),
  amountUsd: confidenceField(z.number()).optional(),
  caixasPorRef: confidenceField(z.number()).optional(),
  pesoLiquidoTotal: confidenceField(z.number()).optional(),
  pesoBrutoTotal: confidenceField(z.number()).optional(),
});

export const espelhoResponseSchema = z.object({
  totalBoxes: confidenceField(z.number()).optional(),
  totalNetWeight: confidenceField(z.number()).optional(),
  totalGrossWeight: confidenceField(z.number()).optional(),
  totalCbm: confidenceField(z.number()).optional(),
  totalAmountUsd: confidenceField(z.number()).optional(),
  shippingLine: confidenceField(z.string()).optional(),
  importerName: confidenceField(z.string()).optional(),
  importerCnpj: confidenceField(z.string()).optional(),
  importerAddress: confidenceField(z.string()).optional(),
  items: z.array(espelhoItemSchema),
});

export type EspelhoResponse = z.infer<typeof espelhoResponseSchema>;
