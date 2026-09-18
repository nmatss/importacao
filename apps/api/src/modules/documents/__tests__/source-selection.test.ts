import { describe, expect, it } from 'vitest';
import { selectAttachedSources, sourceSelectionSchema } from '../source-selection.js';

describe('explicit source inspection', () => {
  const documents = [
    { id: 1, type: 'invoice' },
    { id: 2, type: 'invoice' },
    { id: 3, type: 'duimp' },
    { id: 4, type: 'draft_duimp' },
  ];
  it('can resolve distinct manual/Drive invoices and choose a final DUIMP explicitly', () => {
    expect(selectAttachedSources(documents, { invoiceId: 1, duimpId: 3 }).map((d) => d.id)).toEqual(
      [1, 3],
    );
  });
  it('rejects another process, a wrong type and malformed/repeated query values', () => {
    expect(() => selectAttachedSources(documents, { invoiceId: 999 })).toThrow(/não pertence/);
    expect(() => selectAttachedSources(documents, { invoiceId: 3 })).toThrow(/não pertence/);
    for (const invoiceId of ['-1', '1.2', '1e2', ['1', '2']]) {
      expect(sourceSelectionSchema.safeParse({ invoiceId }).success).toBe(false);
    }
  });
});
