import { describe, it, expect } from 'vitest';
import { scoreExtraction, valuesMatch } from '../score.js';
import { runEval, percentile, checkGate, type EvalCase } from '../runner.js';
import { getSkill } from '../../skills/registry.js';

const cf = (value: unknown, confidence = 0.9) => ({ value, confidence });

describe('valuesMatch', () => {
  it('matches numbers within tolerance, strings up to normalization', () => {
    expect(valuesMatch(1000, 1000.5)).toBe(true); // <2%
    expect(valuesMatch(1000, 1100)).toBe(false);
    expect(valuesMatch('São Paulo', 'sao  paulo')).toBe(true);
    expect(valuesMatch('NINGBO', 'SANTOS')).toBe(false);
  });
  it('coerces a number emitted as a string (not penalized by type)', () => {
    expect(valuesMatch(1020, '1020')).toBe(true);
    expect(valuesMatch('1020', 1020)).toBe(true);
    expect(valuesMatch(1020, 'abc')).toBe(false);
  });
  it('treats scalar arrays order-insensitively (ncmList)', () => {
    expect(valuesMatch(['6115.95.00', '9503.00.99'], ['9503.00.99', '6115.95.00'])).toBe(true);
  });
  it('null gold expects null pred', () => {
    expect(valuesMatch(null, null)).toBe(true);
    expect(valuesMatch(null, 'x')).toBe(false);
  });
});

describe('scoreExtraction', () => {
  const gold = {
    invoiceNumber: cf('INV-1'),
    currency: cf('USD'),
    importerCnpj: cf(null), // expected absent
    items: [{ itemCode: cf('7765Y'), quantity: cf(1200) }],
    totalFobValue: cf(1020),
  };

  it('scores a perfect prediction as 100% with no hallucinations', () => {
    const s = scoreExtraction(gold, gold);
    expect(s.accuracy).toBe(1);
    expect(s.hallucinations).toBe(0);
    // expected = non-null gold leaves: invoiceNumber, currency, items[0].itemCode,
    // items[0].quantity, totalFobValue (importerCnpj is null -> true_negative).
    expect(s.expected).toBe(5);
  });

  it('counts missing, wrong and hallucination correctly', () => {
    const pred = {
      invoiceNumber: cf('INV-1'), // correct
      currency: cf(null), // missing
      importerCnpj: cf('12345678000190'), // hallucination (gold null)
      items: [{ itemCode: cf('WRONG'), quantity: cf(1200) }], // itemCode wrong, qty correct
      totalFobValue: cf(1020), // correct
    };
    const s = scoreExtraction(pred, gold);
    expect(s.correct).toBe(3); // invoiceNumber, items[0].quantity, totalFobValue
    expect(s.missing).toBe(1); // currency
    expect(s.wrong).toBe(1); // items[0].itemCode
    expect(s.hallucinations).toBe(1); // importerCnpj
    expect(s.expected).toBe(5);
  });
});

describe('runEval + gate', () => {
  it('percentile is nearest-rank', () => {
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
    expect(percentile([10, 20, 30, 40], 95)).toBe(40);
    expect(percentile([], 95)).toBe(0);
  });

  it('aggregates accuracy and enforces the gate', async () => {
    const gold = { a: cf('x'), b: cf(10) };
    const cases: EvalCase[] = [
      { name: 'c1', docType: 'invoice', input: null, gold },
      { name: 'c2', docType: 'invoice', input: null, gold },
    ];
    // perfect extractor
    const report = await runEval(cases, async (c) => c.gold);
    expect(report.overallAccuracy).toBe(1);
    expect(checkGate(report).pass).toBe(true);

    // broken extractor → fails the gate
    const bad = await runEval(cases, async () => ({ a: cf(null), b: cf(999) }));
    expect(bad.overallAccuracy).toBeLessThan(0.9);
    expect(checkGate(bad).pass).toBe(false);
  });

  it('records extraction errors as gate failures', async () => {
    const report = await runEval(
      [
        {
          name: 'boom',
          docType: 'invoice',
          input: null,
          gold: { a: { value: 'x', confidence: 1 } },
        },
      ],
      async () => {
        throw new Error('model down');
      },
    );
    expect(report.failures).toBe(1);
    expect(checkGate(report).pass).toBe(false);
  });
});

describe('eval over the real skill gold few-shot (self-consistency)', () => {
  it('every skill few-shot scores 100% against itself', () => {
    for (const docType of [
      'invoice',
      'packing_list',
      'ohbl',
      'draft_bl',
      'proforma_invoice',
      'espelho',
      'certificate',
      'li',
    ]) {
      const gold = JSON.parse(getSkill(docType)!.fewShot![0].json);
      const s = scoreExtraction(gold, gold);
      expect(s.accuracy).toBe(1);
      expect(s.hallucinations).toBe(0);
    }
  });
});
