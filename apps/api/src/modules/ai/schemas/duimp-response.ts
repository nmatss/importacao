import { z } from 'zod';

const confidenceField = <T extends z.ZodTypeAny>(valueSchema: T) =>
  z.object({
    value: valueSchema.nullable(),
    confidence: z.number().min(0).max(1),
  });

/**
 * Draft DUIMP and final DUIMP share the same operational registration fields.
 * A draft may legitimately omit channel/clearance information, so every value
 * remains nullable and the extraction must never infer an absent field.
 */
export const duimpResponseSchema = z.object({
  customsValue: confidenceField(z.number()),
  registrationDollar: confidenceField(z.number()),
  insuranceValue: confidenceField(z.number()),
  duimpNumber: confidenceField(z.string()),
  registeredAt: confidenceField(z.string()),
  customsClearanceAt: confidenceField(z.string()),
  customsChannel: confidenceField(z.string()),
});

export type DuimpResponse = z.infer<typeof duimpResponseSchema>;
