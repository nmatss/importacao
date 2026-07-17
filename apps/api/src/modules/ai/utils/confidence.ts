/**
 * Shared confidence helpers.
 *
 * `computeConfidenceScore` was extracted verbatim from
 * `AIService.calculateConfidence` so the extraction pipeline AND the
 * cross-document reconciliation engine (documents/reconcile.ts) compute the
 * persisted `documents.confidence_score` the EXACT same way — one source of
 * truth, no drift. The badge "78%" the operator sees is `round(score * 100)`.
 */

/** A field counts toward the score only when it actually carries data. */
export function hasConfidenceValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value)) return value.some(hasConfidenceValue);
  if (typeof value === 'object') return Object.values(value).some(hasConfidenceValue);
  return true;
}

/**
 * Weight of an expected-but-empty `{ value, confidence }` field in the score
 * denominator. The schema/template guarantees every expected field comes back
 * (null when not found), so a null-valued wrapper IS the model saying "não
 * achei" — it must drag the score down, or an extraction that read only one
 * field at 0.95 shows a 95% badge (the 2026-06 demo symptom). Weight 1 would
 * punish legitimately-absent fields too hard (LLM docs plateau ~90%); ¼ keeps
 * a fully-populated doc unchanged and sinks near-empty ones below the 0.4
 * review gate.
 */
export const MISSING_FIELD_WEIGHT = 0.25;

/**
 * Cap applied when the anti-hallucination grounding pass was skipped because
 * the source text was too short to verify (scanned/image-only PDFs without
 * OCR). The extraction may be fine, but it was never checked against the
 * document — it must not wear a high-trust badge. 0.75 stays above the 0.7
 * low-confidence threshold's immediate surroundings without reaching the
 * ≥0.8 "high trust" territory, and survives reconciliation (which recomputes
 * through this same function).
 */
export const GROUNDING_SKIPPED_CONFIDENCE_CAP = 0.75;

/**
 * Cap applied while the harness verdict persisted in `_trust.trust` is
 * 'review' (error findings: hallucination, invalid CNPJ, arithmetic
 * inconsistency). Below the 0.4 operational gate on purpose — review means a
 * HUMAN must act (fix/reprocess), and no later recompute may lift the badge
 * while the verdict stands. Without this, the cross-document reconciliation
 * (which recomputes through this same function after an espelho boost/fill)
 * would silently wash the review cap away and re-project the document.
 */
export const REVIEW_CONFIDENCE_CAP = 0.39;

/**
 * Coverage-weighted per-field confidence across every `{ value, confidence }`
 * field (scalars + items[]). Populated fields contribute their confidence;
 * expected fields that came back null/empty contribute 0 with weight
 * MISSING_FIELD_WEIGHT in the denominator, so an extraction that missed most
 * of the document can no longer score high off its few read fields. A harness
 * contract failure caps the score at 0.39, and a skipped grounding pass caps
 * it at GROUNDING_SKIPPED_CONFIDENCE_CAP, so unverifiable extractions can
 * never look trustworthy.
 */
export function computeConfidenceScore(data: Record<string, any>): {
  score: number;
  lowConfidenceFields: string[];
} {
  const lowConfidenceFields: string[] = [];
  let totalConfidence = 0;
  let fieldCount = 0;
  let missingCount = 0;

  for (const [key, value] of Object.entries(data)) {
    if (key === 'items' && Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        for (const [itemKey, itemValue] of Object.entries(value[i] as Record<string, any>)) {
          if (itemValue && typeof itemValue === 'object' && 'confidence' in itemValue) {
            if (
              'value' in itemValue &&
              !hasConfidenceValue((itemValue as { value: unknown }).value)
            ) {
              missingCount++;
              continue;
            }
            const conf = (itemValue as { confidence: number }).confidence;
            totalConfidence += conf;
            fieldCount++;
            if (conf < 0.7) {
              lowConfidenceFields.push(`items[${i}].${itemKey}`);
            }
          }
        }
      }
    } else if (value && typeof value === 'object' && 'confidence' in value) {
      if ('value' in value && !hasConfidenceValue((value as { value: unknown }).value)) {
        missingCount++;
        continue;
      }
      const conf = (value as { confidence: number }).confidence;
      totalConfidence += conf;
      fieldCount++;
      if (conf < 0.7) {
        lowConfidenceFields.push(key);
      }
    }
  }

  let score =
    fieldCount > 0 ? totalConfidence / (fieldCount + MISSING_FIELD_WEIGHT * missingCount) : 0;
  if (data._trust?.groundingSkipped === true) {
    score = Math.min(score, GROUNDING_SKIPPED_CONFIDENCE_CAP);
    lowConfidenceFields.push('_grounding');
  }
  if (data._trust?.trust === 'review') {
    score = Math.min(score, REVIEW_CONFIDENCE_CAP);
  }
  if (data._trust?.contractFailure === true) {
    score = Math.min(score, REVIEW_CONFIDENCE_CAP);
    lowConfidenceFields.push('_contract');
  }
  return { score, lowConfidenceFields };
}
