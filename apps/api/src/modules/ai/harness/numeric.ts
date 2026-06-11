/**
 * Numeric consistency helpers for cross-field harness checks.
 * Used by per-skill numericChecks (e.g. Σ item totals ≈ declared FOB).
 */

import type { HarnessFinding } from './types.js';

/** Relative-tolerance approximate equality (default 1%). Handles zero safely. */
export function approxEqual(a: number, b: number, tolPct = 0.01): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const base = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / base <= tolPct;
}

/** Read a confidenceField numeric value (or null) from a parsed object. */
export function fieldNum(obj: any, key: string): number | null {
  const v = obj?.[key]?.value;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Read a confidenceField value of any type. */
export function fieldVal(obj: any, key: string): any {
  return obj?.[key]?.value ?? null;
}

export function finding(
  field: string,
  message: string,
  severity: HarnessFinding['severity'] = 'warning',
): HarnessFinding {
  return { field, kind: 'numeric', severity, message };
}
