import { describe, expect, it } from 'vitest';
import { parseDraftDuimpItems } from '../duimp-item-text-parser.js';
import { fillDUIMPNullsFromText } from '../duimp-text-parser.js';

const text = `FENICIA ASSESSORIA EM COMERCIO EXTERIOR
Cód. DUIMP: [12]
Nº itens: 1
Adição 1
NCM: 3919.90.90
Item 1
Produto: 26510
REF: 000123-452-UN; ADESIVO
Desc. Unidade Estatística Quant. Merc. Estatística   Unidade COM    QTD COM    Valor Unitário
QUILOGRAMA LIQUIDO        188,5                      UNIDADE        32.362     0,05
Valor do Seguro: 0,00`;

describe('draft DUIMP item table', () => {
  it('reads commercial quantity separately from statistic weight and keeps the exact reference', () => {
    const items = parseDraftDuimpItems(text)!;
    expect(items).toHaveLength(1);
    expect(items[0].itemCode.value).toBe('000123-452-UN');
    expect(items[0].quantity.value).toBe(32362);
    expect(items[0].unitType.value).toBe('UNIDADE');
    expect(items[0].ncmCode.value).toBe('3919.90.90');
  });
  it('rejects missing references, incomplete tables and malformed amounts', () => {
    expect(parseDraftDuimpItems(text.replace('REF:', 'Código:'))).toBeNull();
    expect(parseDraftDuimpItems(text.replace('itens: 1', 'itens: 2'))).toBeNull();
    expect(parseDraftDuimpItems(text.replace('32.362', '32.36'))).toBeNull();
    expect(parseDraftDuimpItems(text.replace('NCM: 3919.90.90', 'NCM:'))).toBeNull();
  });
  it('fills an absent item table without replacing model evidence', () => {
    expect(fillDUIMPNullsFromText({ items: [] }, text).items).toHaveLength(1);
    const items = [{ itemCode: { value: 'DIFFERENT', confidence: 0.95 } }];
    expect(fillDUIMPNullsFromText({ items }, text).items).toBe(items);
  });
});
