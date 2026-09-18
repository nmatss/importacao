import { describe, expect, it } from 'vitest';
import { independentEvidence } from '../independent-evidence.js';
import { reconcileItemizedDoc } from '../reconcile-core.js';
import { flattenAiData } from '../../ai/utils/flatten.js';
import { computeRowStatus } from '../comparison-core.js';

describe('independent document evidence', () => {
  it('cannot corroborate a missing packing weight by copying the espelho', () => {
    const document = { totalGrossWeight: { value: null, confidence: 0 }, items: [] };
    reconcileItemizedDoc(document, 'packing_list', {
      items: [],
      summary: { totalGrossWeight: 100 },
    });
    const comparison = flattenAiData(independentEvidence(document));
    expect(comparison.totalGrossWeight).toBeNull();
    expect(
      computeRowStatus(
        [comparison.totalGrossWeight, 100].filter((v) => v != null),
        'numeric',
      ),
    ).toBe('single_source');
    expect(document.totalGrossWeight.value).toBe(100);
  });

  it('preserves values actually read and independently corroborated', () => {
    const document = { totalGrossWeight: { value: 100, confidence: 0.8 }, items: [] };
    reconcileItemizedDoc(document, 'packing_list', {
      items: [],
      summary: { totalGrossWeight: 100 },
    });
    expect(flattenAiData(independentEvidence(document)).totalGrossWeight).toBe(100);
  });

  it('treats legacy ambiguous lineage conservatively at every depth without mutation', () => {
    const document = { items: [{ quantity: { value: 10, confidence: 0.99, source: 'espelho' } }] };
    expect(flattenAiData(independentEvidence(document)).items[0].quantity).toBeNull();
    expect(document.items[0].quantity.value).toBe(10);
  });
});
