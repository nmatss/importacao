/**
 * Extraction eval scorer — the ruler that decides whether the local model is
 * good enough to promote (Fase 4). Compares a predicted extraction against a
 * gold extraction, field by field, over the `{ value, confidence }` envelope
 * the schemas use.
 *
 * Pure and deterministic: no model call here. The runner (runner.ts) drives the
 * actual extraction and feeds (predicted, gold) pairs into `scoreExtraction`.
 *
 * Metric design (extraction-appropriate):
 *   - "expected" = gold leaves whose value is non-null (what SHOULD be read).
 *   - correct / missing / wrong partition the expected set.
 *   - hallucinations = gold value is null but the model emitted something
 *     (a value invented out of thin air) — tracked separately, since the whole
 *     constitution forbids it.
 *   - accuracy = correct / expected.
 */

const NUM_TOLERANCE = 0.02; // 2% relative, matches the harness's approxEqual.

function normStr(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function numbersMatch(a: number, b: number): boolean {
  if (a === b) return true;
  const denom = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return Math.abs(a - b) / denom <= NUM_TOLERANCE;
}

/** Type-aware deep comparison of two extracted values. */
export function valuesMatch(gold: unknown, pred: unknown): boolean {
  if (gold === null || gold === undefined) return pred === null || pred === undefined;
  if (pred === null || pred === undefined) return false;
  if (typeof gold === 'boolean' || typeof pred === 'boolean') return gold === pred;
  // Numeric comparison, tolerating a model that emits a number as a string
  // (e.g. "1020"). Only when both sides parse to finite numbers.
  if (typeof gold === 'number' || typeof pred === 'number') {
    const g = typeof gold === 'number' ? gold : Number(gold);
    const p = typeof pred === 'number' ? pred : Number(pred);
    if (Number.isFinite(g) && Number.isFinite(p)) return numbersMatch(g, p);
  }
  if (typeof gold === 'string' && typeof pred === 'string') return normStr(gold) === normStr(pred);
  if (Array.isArray(gold) && Array.isArray(pred)) {
    if (gold.length !== pred.length) return false;
    // Order-insensitive for scalar arrays (e.g. ncmList), positional otherwise.
    const scalar = gold.every((g) => typeof g !== 'object');
    if (scalar) {
      const gs = gold.map((g) => normStr(String(g))).sort();
      const ps = pred.map((p) => normStr(String(p))).sort();
      return gs.every((g, i) => g === ps[i]);
    }
    return gold.every((g, i) => valuesMatch(g, pred[i]));
  }
  if (typeof gold === 'object' && typeof pred === 'object') {
    const gk = Object.keys(gold as object);
    return gk.every((k) => valuesMatch((gold as any)[k], (pred as any)[k]));
  }
  return gold === pred;
}

export type FieldStatus = 'correct' | 'missing' | 'wrong' | 'hallucination' | 'true_negative';

export interface FieldResult {
  path: string;
  status: FieldStatus;
  gold: unknown;
  predicted: unknown;
}

export interface ExtractionScore {
  expected: number;
  correct: number;
  missing: number;
  wrong: number;
  hallucinations: number;
  /** correct / expected (1 when there is nothing to extract and nothing wrong). */
  accuracy: number;
  fields: FieldResult[];
}

function isLeaf(node: unknown): node is { value: unknown; confidence?: number } {
  return (
    typeof node === 'object' &&
    node !== null &&
    !Array.isArray(node) &&
    'value' in (node as object) &&
    'confidence' in (node as object)
  );
}

function classify(goldVal: unknown, predNode: any): FieldStatus {
  const predVal = isLeaf(predNode) ? predNode.value : undefined;
  const goldAbsent = goldVal === null || goldVal === undefined;
  const predAbsent = predVal === null || predVal === undefined;
  if (goldAbsent) return predAbsent ? 'true_negative' : 'hallucination';
  if (predAbsent) return 'missing';
  return valuesMatch(goldVal, predVal) ? 'correct' : 'wrong';
}

/** Walk the gold tree, comparing each confidence-field leaf to the prediction. */
export function scoreExtraction(predicted: unknown, gold: unknown): ExtractionScore {
  const fields: FieldResult[] = [];

  function walk(g: any, p: any, path: string): void {
    if (isLeaf(g)) {
      const status = classify(g.value, p);
      fields.push({ path, status, gold: g.value, predicted: isLeaf(p) ? p.value : undefined });
      return;
    }
    if (Array.isArray(g)) {
      for (let i = 0; i < g.length; i++)
        walk(g[i], Array.isArray(p) ? p[i] : undefined, `${path}[${i}]`);
      return;
    }
    if (g && typeof g === 'object') {
      for (const k of Object.keys(g)) {
        walk(g[k], p && typeof p === 'object' ? p[k] : undefined, path ? `${path}.${k}` : k);
      }
    }
  }

  walk(gold, predicted, '');

  // Gold fixtures are an allow-list, not merely a list of fields to grade.
  // Count confidence-envelope values emitted outside that allow-list as
  // hallucinations too. Without this reverse walk a model could invent a
  // completely new field and still receive a perfect score.
  function walkUnexpected(p: any, g: any, path: string): void {
    if (isLeaf(p)) {
      if (!isLeaf(g) && p.value !== null && p.value !== undefined) {
        fields.push({ path, status: 'hallucination', gold: undefined, predicted: p.value });
      }
      return;
    }
    if (Array.isArray(p)) {
      for (let i = 0; i < p.length; i++)
        walkUnexpected(p[i], Array.isArray(g) ? g[i] : undefined, `${path}[${i}]`);
      return;
    }
    if (p && typeof p === 'object') {
      for (const key of Object.keys(p)) {
        walkUnexpected(
          p[key],
          g && typeof g === 'object' ? g[key] : undefined,
          path ? `${path}.${key}` : key,
        );
      }
    }
  }

  walkUnexpected(predicted, gold, '');

  const correct = fields.filter((f) => f.status === 'correct').length;
  const missing = fields.filter((f) => f.status === 'missing').length;
  const wrong = fields.filter((f) => f.status === 'wrong').length;
  const hallucinations = fields.filter((f) => f.status === 'hallucination').length;
  const expected = correct + missing + wrong;
  return {
    expected,
    correct,
    missing,
    wrong,
    hallucinations,
    accuracy: expected === 0 ? 1 : correct / expected,
    fields,
  };
}
