import { describe, it, expect } from 'vitest';
import { generatePuketSheet } from '../puket.template.js';
import * as XLSX from 'xlsx';

const sampleItems = [
  {
    itemCode: 'PK-001',
    description: 'Pijama Infantil Estampado',
    color: 'Azul',
    size: 'P',
    ncmCode: '6108.31.00',
    unitPrice: '5.50',
    quantity: 100,
    boxQuantity: 5,
    netWeight: '25.000',
    grossWeight: '28.500',
    isFreeOfCharge: false,
    requiresLi: true,
    requiresCertification: false,
  },
  {
    itemCode: 'PK-002',
    description: 'Meia Soquete Listrada',
    color: 'Rosa',
    size: 'M',
    ncmCode: '6115.95.00',
    unitPrice: '2.00',
    quantity: 500,
    boxQuantity: 10,
    netWeight: '15.000',
    grossWeight: '17.000',
    isFreeOfCharge: true,
    requiresLi: false,
    requiresCertification: true,
  },
];

describe('generatePuketSheet', () => {
  it('should generate correct headers', () => {
    const ws = generatePuketSheet(sampleItems);
    const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
    expect(data[0]).toMatchSnapshot('puket-headers');
  });

  it('should generate correct item rows', () => {
    const ws = generatePuketSheet(sampleItems);
    const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
    // Skip header (row 0), get data rows
    const itemRows = data.slice(1, data.length - 1);
    expect(itemRows).toMatchSnapshot('puket-item-rows');
  });

  it('should calculate correct totals row', () => {
    const ws = generatePuketSheet(sampleItems);
    const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
    const totalsRow = data[data.length - 1];
    expect(totalsRow).toMatchSnapshot('puket-totals');
  });

  it('should handle empty items', () => {
    const ws = generatePuketSheet([]);
    const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
    expect(data).toMatchSnapshot('puket-empty');
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
    const ws = generatePuketSheet([nullItem]);
    const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
    expect(data).toMatchSnapshot('puket-null-values');
  });

  it('should set column widths', () => {
    const ws = generatePuketSheet(sampleItems);
    expect(ws['!cols']).toMatchSnapshot('puket-col-widths');
  });

  it('should mark FOC and LI rows in formatting metadata', () => {
    const ws = generatePuketSheet(sampleItems);
    expect((ws as any).__formatting).toMatchSnapshot('puket-formatting');
  });
});
