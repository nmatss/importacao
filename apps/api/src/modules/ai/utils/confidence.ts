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
 * Average per-field confidence across every populated `{ value, confidence }`
 * field (scalars + items[]). Fields whose value is null/empty are skipped so
 * they neither help nor hurt the score. A harness contract failure caps the
 * score at 0.39 so unverifiable extractions can never look trustworthy.
 */
export function computeConfidenceScore(data: Record<string, any>): {
  score: number;
  lowConfidenceFields: string[];
} {
  const lowConfidenceFields: string[] = [];
  let totalConfidence = 0;
  let fieldCount = 0;

  for (const [key, value] of Object.entries(data)) {
    if (key === 'items' && Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        for (const [itemKey, itemValue] of Object.entries(value[i] as Record<string, any>)) {
          if (itemValue && typeof itemValue === 'object' && 'confidence' in itemValue) {
            if (
              'value' in itemValue &&
              !hasConfidenceValue((itemValue as { value: unknown }).value)
            ) {
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

  let score = fieldCount > 0 ? totalConfidence / fieldCount : 0;
  if (data._trust?.contractFailure === true) {
    score = Math.min(score, 0.39);
    lowConfidenceFields.push('_contract');
  }
  return { score, lowConfidenceFields };
}
