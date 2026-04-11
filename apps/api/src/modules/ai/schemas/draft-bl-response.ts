import { z } from 'zod';

const confidenceField = <T extends z.ZodTypeAny>(valueSchema: T) =>
  z.object({
    value: valueSchema.nullable(),
    confidence: z.number().min(0).max(1),
  });

export const draftBLResponseSchema = z.object({
  blNumber: confidenceField(z.string()),
  customerReference: confidenceField(z.string()),
  shipper: confidenceField(z.string()),
  consignee: confidenceField(z.string()),
  notifyParty: confidenceField(z.string()),
  vesselName: confidenceField(z.string()),
  voyageNumber: confidenceField(z.string()),
  portOfLoading: confidenceField(z.string()),
  portOfDischarge: confidenceField(z.string()),
  etd: confidenceField(z.string()),
  eta: confidenceField(z.string()),
  shipmentDate: confidenceField(z.string()),
  containerNumber: confidenceField(z.string()),
  sealNumber: confidenceField(z.string()),
  totalBoxes: confidenceField(z.number()),
  totalGrossWeight: confidenceField(z.number()),
  totalCbm: confidenceField(z.number()),
  freightValue: confidenceField(z.number()),
  freightCurrency: confidenceField(z.string()),
  cargoDescription: confidenceField(z.string()),
  freeTime: confidenceField(z.number()),
  woodDeclaration: confidenceField(z.boolean()),
  ncmList: confidenceField(z.array(z.string())),
});

export type DraftBLResponse = z.infer<typeof draftBLResponseSchema>;
