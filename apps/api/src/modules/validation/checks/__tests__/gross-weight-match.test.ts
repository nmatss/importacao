import { describe, it, expect } from 'vitest';
import grossWeightMatch from '../gross-weight-match.js';

describe('gross-weight-match check', () => {
  it('should pass when gross weights match across INV and PL', () => {
    const result = grossWeightMatch({
      invoiceData: { totalGrossWeight: 200, totalNetWeight: 180 },
      packingListData: { totalGrossWeight: 200.3 },
    });
    expect(result.status).toBe('passed');
    expect(result.checkName).toBe('gross-weight-match');
  });

  it('should pass when gross weights match across INV, PL, and BL', () => {
    const result = grossWeightMatch({
      invoiceData: { totalGrossWeight: 500, totalNetWeight: 450 },
      packingListData: { totalGrossWeight: 500.2 },
      blData: { totalGrossWeight: 500.4 },
    });
    expect(result.status).toBe('passed');
  });

  it('should fail when gross weights differ beyond tolerance', () => {
    const result = grossWeightMatch({
      invoiceData: { totalGrossWeight: 200, totalNetWeight: 180 },
      packingListData: { totalGrossWeight: 210 },
    });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('Divergencia');
  });

  it('should fail when gross weight is less than net weight', () => {
    const result = grossWeightMatch({
      invoiceData: { totalGrossWeight: 100, totalNetWeight: 150 },
      packingListData: { totalGrossWeight: 100 },
    });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('nao e maior que o peso liquido');
  });

  it('should warn when less than 2 documents have gross weight', () => {
    const result = grossWeightMatch({
      invoiceData: { totalGrossWeight: 200 },
    });
    expect(result.status).toBe('warning');
    expect(result.message).toContain('insuficientes');
  });

  it('should warn when no data provided', () => {
    const result = grossWeightMatch({});
    expect(result.status).toBe('warning');
  });

  it('should handle NaN values by excluding them', () => {
    const result = grossWeightMatch({
      invoiceData: { totalGrossWeight: 'abc' },
      packingListData: { totalGrossWeight: 200 },
    });
    expect(result.status).toBe('warning');
  });

  it('reads brazilian-formatted weights instead of dropping them as unavailable', () => {
    // `Number("1.234,56")` === NaN: o valor era filtrado e o check dizia
    // "Documentos insuficientes" — apresentava como INDISPONIVEL um dado que existe.
    const result = grossWeightMatch({
      invoiceData: { totalGrossWeight: '1.234,56', totalNetWeight: '1.100,00' },
      packingListData: { totalGrossWeight: 1234.6 },
    });

    expect(result.status).toBe('passed');
    expect(result.message).not.toContain('insuficientes');
  });

  it('never reports an unreadable weight as a missing document', () => {
    const result = grossWeightMatch({
      invoiceData: { totalGrossWeight: 'N/A' },
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('nao comparavel');
    expect(result.message).not.toContain('insuficientes');
  });

  it('refuses to guess the decimal separator of an ambiguous weight', () => {
    const result = grossWeightMatch({
      invoiceData: { totalGrossWeight: '1.234' },
      packingListData: { totalGrossWeight: 1234 },
    });

    // 1.234 pode ser 1234 kg (pt-BR) ou 1,234 kg (en-US): 1000x de diferenca.
    expect(result.status).toBe('warning');
    expect(result.message).toContain('ambiguo');
  });

  it('does not compare a weight declared in another unit', () => {
    const result = grossWeightMatch({
      invoiceData: { totalGrossWeight: '2500 LBS' },
      packingListData: { totalGrossWeight: 1134 },
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('unidade');
  });

  it('uses the Packing List as the declared reference for gross weight', () => {
    const result = grossWeightMatch({
      invoiceData: { totalGrossWeight: 200 },
      packingListData: { totalGrossWeight: 210 },
      blData: { totalGrossWeight: 210.1 },
    });

    // A referencia deixou de ser "o primeiro documento extraido" (INV).
    expect(result.status).toBe('failed');
    expect(result.expectedValue).toContain('fonte: PL');
    expect(result.message).toContain('referencia: PL');
  });

  it('does not fail gross-vs-net when the two values come from different documents', () => {
    const result = grossWeightMatch({
      packingListData: { totalGrossWeight: 100 },
      blData: { totalGrossWeight: 100.2 },
      invoiceData: { totalNetWeight: 150 },
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('documentos diferentes');
  });
});
