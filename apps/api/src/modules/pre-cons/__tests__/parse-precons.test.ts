import { describe, it, expect, vi } from 'vitest';
import * as XLSX from 'xlsx';

// parsePreConsXLSX is pure, but service.ts bootstraps drizzle on import.
vi.mock('../../../shared/database/connection.js', () => ({
  db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(), transaction: vi.fn() },
}));
vi.mock('../../alerts/service.js', () => ({
  alertService: { create: vi.fn().mockResolvedValue(undefined) },
}));

import { parsePreConsXLSX } from '../service.js';

function buildPreConsXlsx(): Buffer {
  // Mirrors the real Pre-Cons layout: a meta row, then a header with "Order"
  // twice (description + processCode) and "ETD", then data rows.
  const aoa = [
    ['Pre-Cons export', '', '', '', '', '', ''],
    ['Order', 'Order', 'ETD', 'IMG Item #', 'NCM', 'Final Quantity', 'Supplier'],
    ['Blouse', 'IM0712602NB', '2026-04-09', 'PI7765Y', '6301.40.00', 800, 'Fine textile'],
    ['Towel', 'IM0712602NB', '2026-04-09', 'PI7766Y', '6301.40.00', 500, 'Fine textile'],
    ['Other', 'PK2042602NB', '2026-04-10', 'AC2285Y', '9503.00.99', 300, 'Acme'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'PreCons');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function buildPreConsLocaleNumberXlsx(): Buffer {
  const aoa = [
    ['Pre-Cons export', '', '', '', '', '', '', ''],
    ['Order', 'Order', 'ETD', 'IMG Item #', 'NCM', 'Final Quantity', 'Agreed Price', 'Amount'],
    [
      'Blouse',
      'IM0712602NB',
      '2026-04-09',
      'PI7765Y',
      '6301.40.00',
      '1.234',
      '1.234,56',
      '2.469,12',
    ],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'PreCons');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('parsePreConsXLSX', () => {
  it('detects the Order+ETD header and extracts processCode/NCM/quantity rows', () => {
    const { rows, sheets } = parsePreConsXLSX(buildPreConsXlsx());
    expect(sheets).toContain('PreCons');
    const target = rows.filter((r) => r.processCode === 'IM0712602NB');
    expect(target.length).toBe(2);
    expect(target[0].itemCode).toBe('PI7765Y');
    expect(target[0].ncmCode).toBe('6301.40.00');
    expect(target[0].quantity).toBe(800);
  });

  it('parses Brazilian locale numbers from Pre-Cons sheets', () => {
    const { rows } = parsePreConsXLSX(buildPreConsLocaleNumberXlsx());

    expect(rows[0].quantity).toBe(1234);
    expect(rows[0].agreedPrice).toBe(1234.56);
    expect(rows[0].amount).toBe(2469.12);
  });
});
