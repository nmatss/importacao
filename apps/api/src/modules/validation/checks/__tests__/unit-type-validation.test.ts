import { describe, expect, it } from 'vitest';

import unitTypeValidation from '../unit-type-validation.js';

describe('unitTypeValidation', () => {
  it('accepts PC/PCS as unit aliases for ordinary unit products', () => {
    const result = unitTypeValidation({
      invoiceData: {
        items: [
          {
            itemCode: 'PI7765Y',
            description: 'LANTERNA DE LED',
            unit: 'PC',
          },
        ],
      },
      packingListData: {
        items: [
          {
            itemCode: 'PI7765Y',
            description: 'LANTERNA DE LED',
            unit: 'PCS',
          },
        ],
      },
    });

    expect(result.status).toBe('passed');
  });

  // Comportamento atualizado de propósito: a unidade "esperada" é INFERIDA da
  // descrição por heurística linguística, não lida de um campo do documento.
  // `failed` marcava pending_correction, movia a pasta no Drive e gerava
  // rascunho de e-mail para a KIOM a partir de um palpite de texto.
  it('still detects pair/set mismatches, but only as a warning', () => {
    const result = unitTypeValidation({
      invoiceData: {
        items: [
          {
            itemCode: 'PI7795Y',
            description: 'KIT COM 4 PECAS',
            unit: 'PC',
          },
        ],
      },
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('esperado SET');
  });

  it.each([
    ['PARKA JACKET', 'par'],
    ['SEPARATE PANTS', 'par'],
    ['CORSET', 'set'],
    ['PARAFUSO SEXTAVADO', 'par'],
  ])('does not detect a unit keyword inside the word %s (substring "%s")', (description) => {
    const result = unitTypeValidation({
      invoiceData: {
        items: [{ itemCode: 'PI7799Y', description, unit: 'PC' }],
      },
    });

    expect(result.status).toBe('passed');
  });

  it('still detects the keyword when it is a standalone word', () => {
    const result = unitTypeValidation({
      invoiceData: {
        items: [{ itemCode: 'PI7798Y', description: 'MEIAS PAR ADULTO', unit: 'PC' }],
      },
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('esperado PAR');
  });
});
