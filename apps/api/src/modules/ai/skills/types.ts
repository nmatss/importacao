/**
 * Extraction "skills" — the per-document-type expertise that lives inside the
 * AI layer. A skill bundles everything needed to extract AND trust a document:
 *   - the specialist prompt (domain knowledge)
 *   - the response schema (structured output enforced on Vertex)
 *   - a verification recipe (the confidence harness config)
 *
 * The registry (registry.ts) maps a document type to its skill, so the AI
 * service can extract + verify uniformly and the trust guarantees are
 * declarative and auditable per document type.
 */

import type { z } from 'zod';
import type { VerificationConfig } from '../harness/types.js';

export interface ExtractionSkill {
  /** Document type key, aligned with the document classifier. */
  type: string;
  /** Human label (PT-BR). */
  label: string;
  /** Structured-output schema (Zod) — also drives Vertex responseSchema. */
  schema: z.ZodTypeAny;
  /** Deterministic trust checks run after extraction. */
  verification: VerificationConfig;
}
