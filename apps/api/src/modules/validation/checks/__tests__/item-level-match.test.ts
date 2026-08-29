import { describe, expect, it } from 'vitest';

import itemLevelMatch from '../item-level-match.js';

describe('itemLevelMatch', () => {
  it('matches invoice items with packing-list FAT prefixes', () => {
    const result = itemLevelMatch({
      invoiceData: {
        items: [
          {
            itemCode: 'PI7765Y',
            quantity: 100,
            description: 'LANTERNA DE LED',
          },
        ],
      },
      packingListData: {
        items: [
          {
            itemCode: 'FAT03PI7765Y',
            quantity: 100,
            description: 'LANTERNA DE LED',
          },
        ],
      },
    });

    expect(result.status).toBe('passed');
    expect(result.message).toContain('Todos os 1 itens');
  });

  it('aggregates repeated lines of the same SKU instead of overwriting them', () => {
    // `invMap.set(code, item)` fazia a ultima linha de cor/tamanho apagar as
    // anteriores: so uma era comparada e "N itens conferidos" nao batia com a
    // invoice.
    const result = itemLevelMatch({
      invoiceData: {
        items: [
          { itemCode: 'PI7752Y', quantity: 60, description: 'MEIA KIDS' },
          { itemCode: 'PI7752Y', quantity: 40, description: 'MEIA KIDS' },
        ],
      },
      packingListData: {
        items: [{ itemCode: 'PI7752Y', quantity: 100, description: 'MEIA KIDS' }],
      },
    });

    expect(result.status).toBe('passed');
    expect(result.actualValue).toContain('2 linhas');
    expect(result.expectedValue).toContain('1 codigos / 2 linhas INV');
  });

  it('reports the aggregated quantity when the summed lines diverge', () => {
    const result = itemLevelMatch({
      invoiceData: {
        items: [
          { itemCode: 'PI7752Y', quantity: 60, description: 'MEIA KIDS' },
          { itemCode: 'PI7752Y', quantity: 40, description: 'MEIA KIDS' },
        ],
      },
      packingListData: {
        items: [{ itemCode: 'PI7752Y', quantity: 90, description: 'MEIA KIDS' }],
      },
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('INV qtd=100 (2 linhas)');
  });

  it('does not treat a missing quantity on both sides as a match', () => {
    // `Number(x ?? 0)` fazia 0 === 0 passar como "quantidades conferem".
    const result = itemLevelMatch({
      invoiceData: { items: [{ itemCode: 'PI7752Y', description: 'MEIA KIDS' }] },
      packingListData: { items: [{ itemCode: 'PI7752Y', description: 'MEIA KIDS' }] },
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('quantidade nao extraida');
  });

  it('reads a brazilian-formatted quantity', () => {
    const result = itemLevelMatch({
      invoiceData: { items: [{ itemCode: 'PI7752Y', quantity: '1.234.567', description: 'MEIA' }] },
      packingListData: { items: [{ itemCode: 'PI7752Y', quantity: 1234567, description: 'MEIA' }] },
    });

    expect(result.status).toBe('passed');
  });

  it('flags descriptions that only share an alphabet', () => {
    // O fuzzy antigo contava PERTINENCIA DE CARACTERE com corte de 80%:
    // duas descricoes de produtos diferentes casavam e descMismatches era
    // sempre 0.
    const result = itemLevelMatch({
      invoiceData: {
        items: [{ itemCode: 'PI7752Y', quantity: 100, description: 'Kids socks dino' }],
      },
      packingListData: {
        items: [{ itemCode: 'PI7752Y', quantity: 100, description: 'Kids socks stripe' }],
      },
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('descricao divergente');
  });

  it('still accepts the same product written slightly differently', () => {
    const result = itemLevelMatch({
      invoiceData: {
        items: [{ itemCode: 'PI7765Y', quantity: 100, description: 'LANTERNA DE LED' }],
      },
      packingListData: {
        items: [{ itemCode: 'PI7765Y', quantity: 100, description: 'LANTERNA LED' }],
      },
    });

    expect(result.status).toBe('passed');
  });

  it('reports lines that carry no item code instead of dropping them', () => {
    const result = itemLevelMatch({
      invoiceData: {
        items: [
          { itemCode: 'PI7752Y', quantity: 100, description: 'MEIA KIDS' },
          { quantity: 10, description: 'FRETE INTERNO' },
        ],
      },
      packingListData: {
        items: [{ itemCode: 'PI7752Y', quantity: 100, description: 'MEIA KIDS' }],
      },
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('Linhas sem codigo de item');
  });
});
