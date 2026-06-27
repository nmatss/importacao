/**
 * Flatten an AI response from the `{ value, confidence }` shape to plain values.
 * Pure (no DB / I/O) so it can be imported by code that must not pull in the
 * database connection. Re-exported from `../service.ts` for back-compat.
 */

/**
 * Flatten AI response from { value, confidence } structure to plain values.
 * Validation checks and comparison logic need plain values, not nested objects.
 */
export function flattenAiData(data: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, val] of Object.entries(data)) {
    // Meta fields (e.g. _trust from the harness) are not extracted data — they
    // must not pollute validation / comparison / UI.
    if (key.startsWith('_')) continue;
    result[key] = flattenValue(val);
  }
  return result;
}

/**
 * Recursively unwrap `{ value, confidence }` confidence fields at ANY depth.
 *
 * The previous implementation only unwrapped top-level fields and `items[]`,
 * leaving nested structures (e.g. `paymentTerms.depositPercent`, or arrays of
 * confidence fields like `ncmList`) as raw `{ value, confidence }` objects in
 * `import_processes.aiExtractedData`. Downstream comparators that read those
 * fields directly then saw `[object Object]` and produced false mismatches /
 * null cross-references (DocIntel audit 2026-06-20, finding A2). Unwrapping
 * recursively keeps the persisted shape flat for every field.
 */
function flattenValue(val: unknown): unknown {
  if (Array.isArray(val)) {
    return val.map((item) => flattenValue(item));
  }
  if (val && typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    // Confidence field — unwrap and keep flattening (value may itself be an
    // array or nested object).
    if ('value' in obj && 'confidence' in obj) {
      return flattenValue(obj.value);
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = flattenValue(v);
    }
    return out;
  }
  return val;
}
