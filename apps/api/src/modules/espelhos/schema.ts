import { z } from 'zod';

export const updateEspelhoItemSchema = z.object({
  itemCode: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  size: z.string().nullable().optional(),
  ncmCode: z.string().nullable().optional(),
  unitPrice: z.union([z.string(), z.number()]).nullable().optional(),
  quantity: z.number().int().nullable().optional(),
  boxQuantity: z.number().int().nullable().optional(),
  netWeight: z.union([z.string(), z.number()]).nullable().optional(),
  grossWeight: z.union([z.string(), z.number()]).nullable().optional(),
  isFreeOfCharge: z.boolean().optional(),
  requiresLi: z.boolean().optional(),
  requiresCertification: z.boolean().optional(),
});

export const addEspelhoItemSchema = z.object({
  itemCode: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  size: z.string().nullable().optional(),
  ncmCode: z.string().nullable().optional(),
  unitPrice: z.union([z.string(), z.number()]).nullable().optional(),
  quantity: z.number().int().nullable().optional(),
  boxQuantity: z.number().int().nullable().optional(),
  netWeight: z.union([z.string(), z.number()]).nullable().optional(),
  grossWeight: z.union([z.string(), z.number()]).nullable().optional(),
  isFreeOfCharge: z.boolean().optional(),
  requiresLi: z.boolean().optional(),
  requiresCertification: z.boolean().optional(),
});

export const markSentToFeniciaSchema = z.object({}).strict().optional();
