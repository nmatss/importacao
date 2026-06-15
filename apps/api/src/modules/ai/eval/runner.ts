/**
 * Eval runner — drives extraction over a set of gold cases and aggregates the
 * verdict that gates promoting the local model (Fase 0/4). Provider-agnostic:
 * the actual extraction is an injected `ExtractFn`, so this orchestration is
 * unit-testable with a fake and works with the real AI service in production.
 *
 * The gate encodes the direction-review criterion: a model is promotable only
 * if it is BOTH accurate enough AND fast enough (the chat() timeout is 90s, so
 * p95 per document must stay safely under it).
 */

import { scoreExtraction, type ExtractionScore } from './score.js';

export interface EvalCase {
  name: string;
  docType: string;
  /** Whatever the ExtractFn needs (text, image base64, file path…). */
  input: unknown;
  /** Gold extraction in the `{ value, confidence }` envelope. */
  gold: unknown;
}

export type ExtractFn = (c: EvalCase) => Promise<unknown>;

export interface CaseResult {
  name: string;
  docType: string;
  score: ExtractionScore | null;
  latencyMs: number;
  error?: string;
}

export interface EvalReport {
  cases: CaseResult[];
  overallAccuracy: number;
  totalHallucinations: number;
  totalExpected: number;
  totalCorrect: number;
  latencyMs: { p50: number; p95: number; max: number };
  failures: number;
}

/** Nearest-rank percentile of a numeric sample. Pure. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

export async function runEval(cases: EvalCase[], extract: ExtractFn): Promise<EvalReport> {
  const results: CaseResult[] = [];
  for (const c of cases) {
    const start = Date.now();
    try {
      const predicted = await extract(c);
      const latencyMs = Date.now() - start;
      results.push({
        name: c.name,
        docType: c.docType,
        score: scoreExtraction(predicted, c.gold),
        latencyMs,
      });
    } catch (err) {
      results.push({
        name: c.name,
        docType: c.docType,
        score: null,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const scored = results.filter((r) => r.score);
  const totalCorrect = scored.reduce((a, r) => a + r.score!.correct, 0);
  const totalExpected = scored.reduce((a, r) => a + r.score!.expected, 0);
  const latencies = results.map((r) => r.latencyMs);

  return {
    cases: results,
    totalCorrect,
    totalExpected,
    overallAccuracy: totalExpected === 0 ? 0 : totalCorrect / totalExpected,
    totalHallucinations: scored.reduce((a, r) => a + r.score!.hallucinations, 0),
    latencyMs: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      max: percentile(latencies, 100),
    },
    failures: results.filter((r) => r.error).length,
  };
}

export interface PromotionGate {
  minAccuracy: number; // e.g. 0.9
  maxP95Ms: number; // e.g. 90_000 (chat() timeout)
  maxHallucinations: number; // e.g. 0
}

export const DEFAULT_GATE: PromotionGate = {
  minAccuracy: 0.9,
  maxP95Ms: 90_000,
  maxHallucinations: 0,
};

/** Decide whether a report clears the promotion gate, with reasons. */
export function checkGate(
  report: EvalReport,
  gate: PromotionGate = DEFAULT_GATE,
): {
  pass: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (report.failures > 0) reasons.push(`${report.failures} caso(s) falharam na extração`);
  if (report.overallAccuracy < gate.minAccuracy)
    reasons.push(
      `acurácia ${(report.overallAccuracy * 100).toFixed(1)}% < ${(gate.minAccuracy * 100).toFixed(0)}%`,
    );
  if (report.latencyMs.p95 > gate.maxP95Ms)
    reasons.push(`p95 ${report.latencyMs.p95}ms > ${gate.maxP95Ms}ms`);
  if (report.totalHallucinations > gate.maxHallucinations)
    reasons.push(`${report.totalHallucinations} alucinação(ões) > ${gate.maxHallucinations}`);
  return { pass: reasons.length === 0, reasons };
}

export function formatReport(report: EvalReport, gate: PromotionGate = DEFAULT_GATE): string {
  const { pass, reasons } = checkGate(report, gate);
  const lines = [
    `Eval: ${report.cases.length} casos | acurácia ${(report.overallAccuracy * 100).toFixed(1)}% (${report.totalCorrect}/${report.totalExpected})`,
    `Alucinações: ${report.totalHallucinations} | falhas: ${report.failures}`,
    `Latência: p50 ${report.latencyMs.p50}ms · p95 ${report.latencyMs.p95}ms · max ${report.latencyMs.max}ms`,
    `GATE: ${pass ? 'PASSOU ✅' : 'REPROVOU ❌ — ' + reasons.join('; ')}`,
  ];
  for (const c of report.cases) {
    lines.push(
      c.error
        ? `  - ${c.name} (${c.docType}): ERRO ${c.error}`
        : `  - ${c.name} (${c.docType}): ${(c.score!.accuracy * 100).toFixed(0)}% · ${c.score!.correct}/${c.score!.expected} · ${c.score!.hallucinations} aluc · ${c.latencyMs}ms`,
    );
  }
  return lines.join('\n');
}
