import { describe, it, expect } from 'vitest';
import {
  computeConfidenceScore,
  GROUNDING_SKIPPED_CONFIDENCE_CAP,
  MISSING_FIELD_WEIGHT,
  REVIEW_CONFIDENCE_CAP,
} from '../confidence.js';

function cf<T>(value: T, confidence = 0.9) {
  return { value, confidence };
}

describe('computeConfidenceScore — ponderação por cobertura', () => {
  it('extração totalmente populada mantém a média simples (sem penalidade)', () => {
    const { score } = computeConfidenceScore({
      invoiceNumber: cf('INV-001', 0.9),
      exporterName: cf('ACME', 0.8),
    });
    expect(score).toBeCloseTo(0.85, 5);
  });

  it('extração quase vazia não pontua alto pelos poucos campos lidos (sintoma do demo)', () => {
    // 1 campo lido a 0.95 + 15 campos esperados que voltaram null.
    const data: Record<string, any> = { invoiceNumber: cf('INV-001', 0.95) };
    for (let i = 0; i < 15; i++) data[`field${i}`] = cf(null, 0);
    const { score } = computeConfidenceScore(data);
    // 0.95 / (1 + 0.25*15) = 0.2 → abaixo do gate de revisão (0.4).
    expect(score).toBeCloseTo(0.95 / (1 + MISSING_FIELD_WEIGHT * 15), 5);
    expect(score).toBeLessThan(0.4);
  });

  it('poucos campos legitimamente nulos causam só penalidade branda', () => {
    const data: Record<string, any> = {};
    for (let i = 0; i < 13; i++) data[`f${i}`] = cf(`v${i}`, 0.9);
    for (let i = 0; i < 3; i++) data[`null${i}`] = cf(null, 0);
    const { score } = computeConfidenceScore(data);
    // (13*0.9) / (13 + 0.25*3) = 0.851 — não despenca por nulos legítimos.
    expect(score).toBeCloseTo((13 * 0.9) / (13 + MISSING_FIELD_WEIGHT * 3), 5);
    expect(score).toBeGreaterThan(0.8);
  });

  it('campos de item nulos também entram na penalidade de cobertura', () => {
    const { score } = computeConfidenceScore({
      items: [{ itemCode: cf('A1', 0.9), ean: cf(null, 0), ncmCode: cf(null, 0) }],
    });
    expect(score).toBeCloseTo(0.9 / (1 + MISSING_FIELD_WEIGHT * 2), 5);
  });

  it('grounding pulado limita o score ao cap e sinaliza _grounding', () => {
    const { score, lowConfidenceFields } = computeConfidenceScore({
      invoiceNumber: cf('INV-001', 0.95),
      exporterName: cf('ACME', 0.95),
      _trust: { groundingSkipped: true },
    });
    expect(score).toBe(GROUNDING_SKIPPED_CONFIDENCE_CAP);
    expect(lowConfidenceFields).toContain('_grounding');
  });

  it('veredito review persistido em _trust capa o score — a reconciliação não pode lavá-lo', () => {
    // Cenário do review: invoice com erro aritmético foi capada em 0.39 na
    // extração; depois o espelho boosta campos a 0.97 e a reconciliação
    // RECOMPUTA por esta função. O cap precisa sobreviver ao recompute.
    const { score } = computeConfidenceScore({
      invoiceNumber: cf('INV-001', 0.97),
      totalFobValue: cf(24312.52, 0.97),
      _trust: { trust: 'review' },
    });
    expect(score).toBeLessThanOrEqual(REVIEW_CONFIDENCE_CAP);
  });

  it('contractFailure continua capando em 0.39 mesmo com grounding pulado', () => {
    const { score } = computeConfidenceScore({
      invoiceNumber: cf('INV-001', 0.95),
      _trust: { groundingSkipped: true, contractFailure: true },
    });
    expect(score).toBeLessThanOrEqual(0.39);
  });
});
