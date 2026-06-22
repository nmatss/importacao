import { describe, it, expect } from 'vitest';
import { classifyDocument } from '../classify-document.js';

describe('classifyDocument — convencao KIOM PI (incidente 2026-06-22)', () => {
  it('"KIOM PI - ..." classifica como proforma_invoice', () => {
    expect(classifyDocument('KIOM PI - IM2402608AXI.xlsx')).toBe('proforma_invoice');
    expect(classifyDocument('KIOM PI - PK1892606BXI.pdf')).toBe('proforma_invoice');
  });
  it('"KIOM CI - ..." continua invoice (CI = commercial invoice)', () => {
    expect(classifyDocument('KIOM CI - IM0732604NB.pdf')).toBe('invoice');
  });
  it('proforma explicito continua proforma', () => {
    expect(classifyDocument('Proforma Invoice 123.pdf')).toBe('proforma_invoice');
  });
  it('codigo de processo "PI4257Y" embutido NAO vira proforma', () => {
    // token "pi4257y" != "pi"; deve cair em invoice pelo INV/CI ou outro, nao proforma
    expect(classifyDocument('Commercial Invoice PI4257Y.pdf')).toBe('invoice');
  });
});
