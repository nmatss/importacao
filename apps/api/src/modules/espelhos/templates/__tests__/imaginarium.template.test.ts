import { describe, it, expect } from 'vitest';
import { generateImaginariumSheet } from '../imaginarium.template.js';
import * as XLSX from 'xlsx';

const sampleItems = [
  {
    itemCode: 'IMG-001',
    description: 'Luminaria Decorativa LED',
    color: 'Dourado',
    size: 'U',
    ncmCode: '9405.40.90',
    unitPrice: '12.75',
    quantity: 200,
    boxQuantity: 8,
    netWeight: '120.000',
    grossWeight: '145.000',
    isFreeOfCharge: false,
    requiresLi: false,
    requiresCertification: true,
  },
  {
    itemCode: 'IMG-002',
    description: 'Caneca Termica Personalizada',
    color: 'Branco',
    size: 'M',
    ncmCode: '6912.00.00',
    unitPrice: '3.25',
    quantity: 1000,
    boxQuantity: 20,
    netWeight: '350.000',
    grossWeight: '410.000',
    isFreeOfCharge: true,
    requiresLi: true,
    requiresCertification: false,
  },
];

describe('generateImaginariumSheet', () => {
  it('should generate correct headers', () => {
    const ws = generateImaginariumSheet(sampleItems);
    const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
    expect(data[0]).toMatchSnapshot('imaginarium-headers');
  });

  it('should generate correct item rows', () => {
    const ws = generateImaginariumSheet(sampleItems);
    const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
    const itemRows = data.slice(1, data.length - 1);
    expect(itemRows).toMatchSnapshot('imaginarium-item-rows');
  });

  it('should calculate correct totals row', () => {
    const ws = generateImaginariumSheet(sampleItems);
    const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
    const totalsRow = data[data.length - 1];
    expect(totalsRow).toMatchSnapshot('imaginarium-totals');
  });

  it('should handle empty items', () => {
    const ws = generateImaginariumSheet([]);
    const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
    expect(data).toMatchSnapshot('imaginarium-empty');
  });

  it('should handle null values in items', () => {
    const nullItem = {
      itemCode: null,
      description: null,
      color: null,
      size: null,
      ncmCode: null,
      unitPrice: null,
      quantity: null,
      boxQuantity: null,
      netWeight: null,
      grossWeight: null,
      isFreeOfCharge: null,
      requiresLi: null,
      requiresCertification: null,
    };
    const ws = generateImaginariumSheet([nullItem]);
    const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
    expect(data).toMatchSnapshot('imaginarium-null-values');
  });

  it('should set column widths', () => {
    const ws = generateImaginariumSheet(sampleItems);
    expect(ws['!cols']).toMatchSnapshot('imaginarium-col-widths');
  });

  it('should mark FOC and LI rows in formatting metadata', () => {
    const ws = generateImaginariumSheet(sampleItems);
    expect((ws as any).__formatting).toMatchSnapshot('imaginarium-formatting');
  });
});
