import { z } from 'zod';

const confidenceField = <T extends z.ZodTypeAny>(valueSchema: T) =>
  z.object({
    value: valueSchema.nullable(),
    confidence: z.number().min(0).max(1),
  });

/**
 * Item de uma Licença de Importação (LI / Siscomex). A LI é uma licença
 * administrativa por NCM/destaque — não traz preço/valor por SKU como uma
 * invoice; o que ela arrola é descrição + NCM + quantidade + valor declarado
 * por item (a base que os órgãos anuentes deferem).
 */
const liItemSchema = z.object({
  ncmCode: confidenceField(z.string()),
  description: confidenceField(z.string()),
  quantity: confidenceField(z.number()),
  unitPrice: confidenceField(z.number()).optional(),
});

/**
 * Licença de Importação (LI) — registro administrativo no Siscomex.
 * Campos plausíveis de uma LI: número, datas de registro e deferimento,
 * status, importador (BR, com CNPJ), exportador (estrangeiro), os itens por
 * NCM, o valor total declarado, a moeda, o incoterm e os órgãos anuentes que
 * precisam deferir a licença.
 *
 * Cada folha é {value, confidence} (confidenceField). Campos opcionais podem
 * faltar em LIs simples (anuência única, sem deferimento ainda etc.).
 */
export const liResponseSchema = z.object({
  // ── Identificação ──────────────────────────────────────────────────
  liNumber: confidenceField(z.string()),
  registrationDate: confidenceField(z.string()),
  deferralDate: confidenceField(z.string()).optional(),
  status: confidenceField(z.string()),

  // ── Partes ─────────────────────────────────────────────────────────
  importerName: confidenceField(z.string()),
  importerCnpj: confidenceField(z.string()),
  exporterName: confidenceField(z.string()),

  // ── Itens / mercadoria ─────────────────────────────────────────────
  items: z.array(liItemSchema),

  // ── Valores / condições ────────────────────────────────────────────
  totalValue: confidenceField(z.number()),
  currency: confidenceField(z.string()),
  incoterm: confidenceField(z.string()).optional(),

  // ── Anuência (órgãos que deferem a LI) ─────────────────────────────
  anuentes: confidenceField(z.array(z.string())).optional(),
});

export type LiResponse = z.infer<typeof liResponseSchema>;
