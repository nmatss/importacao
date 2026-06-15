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

/** A gold-standard input→output example. Few-shot is the single biggest lever
 *  for a SMALL model's accuracy on a narrow task — it shows the exact reading
 *  discipline expected. `description` frames the case (in PT-BR); `json` is the
 *  expected extraction, verbatim, for that case. */
export interface FewShotExample {
  description: string;
  json: string;
}

/** Which knowledge-base namespaces to retrieve (RAG) and inject as authoritative
 *  domain context before extraction, to ground a small model. Namespaces map to
 *  the KB files under ../knowledge/ (e.g. 'ncms', 'parties', 'ports'). */
export interface RetrievalConfig {
  namespaces: string[];
  /** Max snippets to inject per namespace. */
  k: number;
}

export interface ExtractionSkill {
  /** Document type key, aligned with the document classifier. */
  type: string;
  /** Human label (PT-BR). */
  label: string;
  /** Structured-output schema (Zod) — also drives Vertex responseSchema. */
  schema: z.ZodTypeAny;
  /** Deterministic trust checks run after extraction. */
  verification: VerificationConfig;

  // ── Specialist layer (optional — a skill grows smarter as these are filled) ──
  /** Per-document expert knowledge appended to the shared constitution: the
   *  field-by-field reading rules, gotchas and disambiguations for THIS doc
   *  type. This is the "specialist prompt" the skill was always meant to carry. */
  domainRules?: string;
  /** Gold exemplars shown to the model before the real document. */
  fewShot?: FewShotExample[];
  /** RAG retrieval plan — which domain knowledge to inject as context. */
  retrieval?: RetrievalConfig;
}
