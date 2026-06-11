/**
 * EAN knowledge-base lookup for the espelho pipeline.
 *
 * The KB lives in ../ai/knowledge/ean.json with shape
 *   { puket: EanKbRow[], imaginarium: EanKbRow[], truncated, ... }
 * where each row maps an EAN barcode to a product code + grade/color/line
 * (built from the 'Base EAN - Espelho' tabs of the Follow Up spreadsheet).
 *
 * One product code typically maps to SEVERAL EANs (one per grade × color),
 * so a bare itemCode→EAN fill is only safe when the candidates collapse to a
 * single EAN — optionally after narrowing by the item's color/size. When the
 * lookup stays ambiguous we return null (never guess — same anti-hallucination
 * stance as the AI harness).
 *
 * Pure helpers + a memoized default index, mirroring ai/harness/knowledge.ts:
 * a missing/empty KB degrades to "no enrichment", never to an error.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizeGtin } from '../ai/harness/format.js';

export interface EanKbRow {
  ean: string;
  product: string;
  grade?: string | null;
  color?: string | null;
  line?: string | null;
}

/** Normalized product code → KB rows (only rows with a check-digit-valid EAN). */
export type EanIndex = Map<string, EanKbRow[]>;

/** Same normalization used by the espelho item-code join. */
export function normalizeItemCode(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  return String(raw)
    .toUpperCase()
    .replace(/[\s\-./\\_]/g, '');
}

/** Build an index from KB rows. Rows with invalid/missing EANs are dropped. */
export function createEanIndex(rows: EanKbRow[]): EanIndex {
  const index: EanIndex = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const ean = normalizeGtin(row.ean);
    const key = normalizeItemCode(row.product);
    if (!ean || !key) continue;
    const entry = { ...row, ean };
    const existing = index.get(key);
    if (existing) existing.push(entry);
    else index.set(key, [entry]);
  }
  return index;
}

/**
 * Look up the EAN for an item code, optionally narrowing by color/size
 * (size is matched against the KB 'grade', e.g. "34 A 39").
 * Returns the EAN only when the match is unambiguous; null otherwise.
 */
export function lookupEan(
  index: EanIndex,
  itemCode: unknown,
  opts: { color?: unknown; size?: unknown } = {},
): string | null {
  const key = normalizeItemCode(itemCode);
  if (!key) return null;
  let candidates = index.get(key);
  if (!candidates || candidates.length === 0) return null;

  const color = normalizeItemCode(opts.color);
  if (color) {
    const byColor = candidates.filter((r) => normalizeItemCode(r.color) === color);
    if (byColor.length > 0) candidates = byColor;
  }

  const size = normalizeItemCode(opts.size);
  if (size) {
    const byGrade = candidates.filter((r) => {
      const grade = normalizeItemCode(r.grade);
      return grade !== '' && (grade === size || grade.includes(size) || size.includes(grade));
    });
    if (byGrade.length > 0) candidates = byGrade;
  }

  const distinct = new Set(candidates.map((r) => r.ean));
  return distinct.size === 1 ? candidates[0].ean : null;
}

let defaultIndex: EanIndex | null = null;

/** Memoized index over ai/knowledge/ean.json (all brands merged). */
export function getDefaultEanIndex(): EanIndex {
  if (defaultIndex) return defaultIndex;
  let rows: EanKbRow[] = [];
  try {
    const p = fileURLToPath(new URL('../ai/knowledge/ean.json', import.meta.url));
    const kb = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
    for (const value of Object.values(kb)) {
      if (Array.isArray(value)) rows = rows.concat(value as EanKbRow[]);
    }
  } catch {
    rows = [];
  }
  defaultIndex = createEanIndex(rows);
  return defaultIndex;
}

/** Test seam — reset the memoized KB index (used by unit tests). */
export function _clearEanIndexCache(): void {
  defaultIndex = null;
}
