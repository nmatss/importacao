/**
 * Pre-computed JSON Schema objects derived from each Zod extraction schema.
 * Passed to the chat provider as `responseSchema` to get structured-output
 * mode (Gemini honors the constraint and emits JSON matching the shape,
 * eliminating the "AI returned weird JSON" class of bugs).
 *
 * We strip `$schema` and `$ref` machinery to keep the payload compatible
 * with both OpenRouter's `json_schema` and Vertex's `responseSchema` —
 * both accept a flat OpenAPI-3-flavored JSON Schema and reject some draft-7
 * features.
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import { invoiceResponseSchema } from './schemas/invoice-response.js';
import { proformaResponseSchema } from './schemas/proforma-response.js';
import { packingListResponseSchema } from './schemas/packing-list-response.js';
import { blResponseSchema } from './schemas/bl-response.js';
import { draftBLResponseSchema } from './schemas/draft-bl-response.js';
import { certificateResponseSchema } from './schemas/certificate-response.js';
import { emailAnalysisResponseSchema } from './schemas/email-analysis-response.js';
import { espelhoResponseSchema } from './schemas/espelho-response.js';
import { liResponseSchema } from './schemas/li-response.js';

/**
 * Convert a Zod schema to a JSON Schema suitable for Gemini structured output.
 * Strips draft-7-only fields that Vertex rejects (additionalProperties booleans,
 * $ref, $schema, definitions).
 */
function toGeminiSchema(
  zod: Parameters<typeof zodToJsonSchema>[0],
  name: string,
): Record<string, unknown> {
  const raw = zodToJsonSchema(zod, { name, $refStrategy: 'none' }) as Record<string, unknown>;
  // The wrapper adds { $ref: '#/definitions/<name>', definitions: { ... } } —
  // we want the inner schema flat.
  const defs = (raw as any).definitions;
  const inner = defs && defs[name] ? defs[name] : raw;
  return stripUnsupported(inner);
}

function stripUnsupported(node: any): any {
  if (Array.isArray(node)) return node.map(stripUnsupported);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === '$schema' || k === '$ref' || k === '$id' || k === 'definitions') continue;
      // Vertex doesn't allow `additionalProperties: boolean`; drop entirely
      if (k === 'additionalProperties') continue;
      out[k] = stripUnsupported(v);
    }
    return out;
  }
  return node;
}

export const EXTRACTION_SCHEMAS = {
  invoice: toGeminiSchema(invoiceResponseSchema, 'invoice'),
  proforma: toGeminiSchema(proformaResponseSchema, 'proforma'),
  packing_list: toGeminiSchema(packingListResponseSchema, 'packing_list'),
  bl: toGeminiSchema(blResponseSchema, 'bl'),
  draft_bl: toGeminiSchema(draftBLResponseSchema, 'draft_bl'),
  certificate: toGeminiSchema(certificateResponseSchema, 'certificate'),
  li: toGeminiSchema(liResponseSchema, 'li'),
  email_analysis: toGeminiSchema(emailAnalysisResponseSchema, 'email_analysis'),
  espelho: toGeminiSchema(espelhoResponseSchema, 'espelho'),
} as const;

export type ExtractionSchemaKey = keyof typeof EXTRACTION_SCHEMAS;
