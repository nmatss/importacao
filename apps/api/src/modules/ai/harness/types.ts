/**
 * AI Confidence Harness — types.
 *
 * The harness runs AFTER an AI extraction and BEFORE the result is trusted.
 * It is the "confiança por construção" layer: deterministic checks that catch
 * hallucinations, malformed values and out-of-domain data that the LLM (even
 * with structured output) can still emit. Findings downgrade confidence and,
 * on errors, flag the extraction for human review — nothing low-trust is
 * silently accepted.
 */

export type TrustLevel = 'trusted' | 'review';

export type FindingKind = 'grounding' | 'format' | 'numeric' | 'knowledge';

export interface HarnessFinding {
  field: string;
  kind: FindingKind;
  severity: 'error' | 'warning';
  message: string;
}

export interface HarnessReport {
  trust: TrustLevel;
  /** Fields that should be sent to human review (grounding/format errors). */
  reviewFields: string[];
  findings: HarnessFinding[];
  /** 0..1 — starts at 1.0, decremented per finding. */
  adjustedConfidence: number;
  checkedAt: string;
}

/**
 * Per-document-type verification recipe. Field paths support two forms:
 *   - "totalFobValue"      → a top-level confidenceField
 *   - "items[].itemCode"   → a field inside every element of the items array
 */
export interface VerificationConfig {
  /** String fields whose value MUST appear literally in the source text (anti-hallucination). */
  groundedFields?: string[];
  /** NCM code fields — validated for format XXXX.XX.XX and (if KB present) catalog membership. */
  ncmFields?: string[];
  /** ISO-8601 date fields. */
  dateFields?: string[];
  /** Brazilian CNPJ fields — validated by check digits. */
  cnpjFields?: string[];
  /** Container number fields — validated against ISO 6346 (incl. check digit). */
  containerFields?: string[];
  /** Currency fields that must resolve to USD for international invoices. */
  usdCurrencyFields?: string[];
  /** Port fields validated against the knowledge base. */
  portFields?: Array<{ field: string; kind: 'loading' | 'discharge' }>;
  /** Supplier/exporter name fields validated against the knowledge base. */
  supplierFields?: string[];
  /** Cross-field numeric consistency rules (e.g. Σ items ≈ total). */
  numericChecks?: Array<(data: Record<string, any>) => HarnessFinding | null>;
}
