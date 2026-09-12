/** Default extraction floor for non-BL documents. */
export const MIN_OPERATIONAL_CONFIDENCE = 0.4;
/** BL reading gate, distinct from completeness and business conformity. */
export const MIN_BL_OPERATIONAL_CONFIDENCE = 0.9;

export function hasOperationalConfidence(
  type: string,
  confidenceScore: string | number | null | undefined,
): boolean {
  const isBl = type === 'ohbl' || type === 'draft_bl';
  // Legacy non-BL documents preserve their existing behavior; a BL without
  // a measured score cannot demonstrate the required 90% reading threshold.
  if (confidenceScore == null) return !isBl;
  const confidence =
    typeof confidenceScore === 'number' ? confidenceScore : Number(confidenceScore);
  return (
    Number.isFinite(confidence) &&
    confidence <= 1 &&
    confidence >= (isBl ? MIN_BL_OPERATIONAL_CONFIDENCE : MIN_OPERATIONAL_CONFIDENCE)
  );
}
