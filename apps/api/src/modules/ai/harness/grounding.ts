/**
 * Grounding (anti-hallucination): a value the AI claims to have extracted must
 * actually appear in the source document text. Catches fabricated invoice
 * numbers, BL numbers, container IDs, NCMs, CNPJs etc.
 *
 * Comparison is alphanumeric-normalized so that "PI 7752-Y", "pi7752y" and
 * "PI7752Y" all match, and OCR spacing/punctuation noise is ignored.
 */

export function normalizeForGrounding(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Returns true if `value` is grounded in `sourceText`.
 * Values shorter than 3 normalized chars are treated as grounded (too short to
 * meaningfully verify — avoids false alarms on tiny tokens).
 */
export function appearsInSource(value: string, sourceText: string): boolean {
  const v = normalizeForGrounding(value);
  if (v.length < 3) return true;
  const src = normalizeForGrounding(sourceText);
  return src.includes(v);
}
