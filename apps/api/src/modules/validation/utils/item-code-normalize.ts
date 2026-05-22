/**
 * Normalizes a SKU / item-code for cross-document matching.
 * Strips whitespace, dashes, dots, slashes; uppercases.
 * Example: "PI 7752Y", "pi-7752y", "PI.7752Y" all -> "PI7752Y"
 */
export function normalizeItemCode(value: unknown): string {
  if (value == null) return '';
  return String(value)
    .toUpperCase()
    .replace(/[\s\-./\\_]/g, '');
}

export function itemCodesMatch(a: unknown, b: unknown): boolean {
  const na = normalizeItemCode(a);
  const nb = normalizeItemCode(b);
  if (!na || !nb) return false;
  return na === nb;
}

// Uni.co item codes follow patterns like PI7752Y, AC2285Y, PKT123, IM0712:
// 2-4 letter prefix + 3-7 digits + optional 1-3 letter suffix.
// Anything else around it (FALL/24, WHITE BOX, brand, supplier ref) is noise.
const CANONICAL_CODE_RE = /\b([A-Z]{2,4}\d{3,7}[A-Z]{0,3})\b/;

/**
 * Strips column-bleed prefixes/suffixes from a raw item-code value extracted
 * by the AI. Nicolas (2026-05-21 meeting): "ele tá juntando essa coluna de
 * coleção como código do item". Example: "FALL/24 PI7752Y" -> "PI7752Y".
 *
 * Conservative: only rewrites the value when the canonical-pattern regex
 * finds exactly one match AND the original string had extra characters.
 * Returns the original string when no clear canonical code is detected,
 * so we never silently corrupt unfamiliar code formats.
 */
export function extractCanonicalItemCode(raw: unknown): string {
  if (raw == null) return '';
  const original = String(raw).trim();
  if (!original) return '';
  const upper = original.toUpperCase();
  const matches = upper.match(new RegExp(CANONICAL_CODE_RE.source, 'g'));
  if (!matches || matches.length === 0) return original;
  // If the original IS the canonical code with normal punctuation, leave it
  // alone (we don't want to drop valid PI 7752Y → PI7752Y here — that's
  // normalizeItemCode's job at compare-time).
  if (matches.length === 1 && upper === matches[0]) return original;
  if (matches.length === 1) {
    // Single canonical code embedded in noise — return the canonical.
    return matches[0];
  }
  // Multiple canonical-looking codes (rare): keep the original to avoid
  // arbitrarily picking one. Operator must review.
  return original;
}

/**
 * Walks the items[] in an AI extraction result (BEFORE flattening, i.e. with
 * `{value, confidence}` wrappers) and replaces itemCode.value with the
 * canonical form when noise is detected. Mutates and returns the input.
 */
export function cleanItemCodesInAiData<T extends Record<string, any>>(data: T): T {
  if (!data || !Array.isArray((data as any).items)) return data;
  for (const item of (data as any).items as Array<Record<string, any>>) {
    const code = item.itemCode;
    if (code && typeof code === 'object' && 'value' in code) {
      const cleaned = extractCanonicalItemCode(code.value);
      if (cleaned !== code.value) {
        code.value = cleaned;
      }
    } else if (typeof code === 'string') {
      item.itemCode = extractCanonicalItemCode(code);
    }
  }
  return data;
}
