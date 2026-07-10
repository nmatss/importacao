import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_EXTRACTION_EVAL_CORPUS,
  EVAL_CORPUS_VERSION,
  validateEvalCorpus,
} from '../corpus.js';
import { runEval } from '../runner.js';

describe('document extraction eval corpus', () => {
  it('is versioned, synthetic, complete and safe for source control', () => {
    expect(EVAL_CORPUS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    expect(DOCUMENT_EXTRACTION_EVAL_CORPUS.length).toBeGreaterThanOrEqual(4);
    expect(validateEvalCorpus()).toEqual([]);
  });

  it('runs reproducibly through the evaluation runner', async () => {
    const report = await runEval(
      [...DOCUMENT_EXTRACTION_EVAL_CORPUS],
      async (fixture) => fixture.gold,
    );
    expect(report.failures).toBe(0);
    expect(report.overallAccuracy).toBe(1);
    expect(report.totalHallucinations).toBe(0);
  });
});
