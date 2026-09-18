/** Keep document comparisons independent from values copied out of the espelho.
 * Legacy `source=espelho` does not distinguish copied from corroborated values:
 * require re-extraction instead of counting that unknown lineage twice.
 * The stored extraction is deliberately left intact for review/audit.
 */
export function independentEvidence<T>(value: T): T {
  if (Array.isArray(value)) return value.map(independentEvidence) as T;
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  const record = value as Record<string, unknown>;
  if ('value' in record && record.source === 'espelho') {
    return { ...record, value: null, confidence: 0 } as T;
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, child]) => [key, independentEvidence(child)]),
  ) as T;
}
