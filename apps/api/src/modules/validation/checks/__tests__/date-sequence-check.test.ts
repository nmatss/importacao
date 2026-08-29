import { describe, expect, it } from 'vitest';
import dateSequenceCheck from '../date-sequence-check.js';
import { parseDate } from '../../utils/date-compare.js';

describe('dateSequenceCheck', () => {
  it('trata ETD historica como aviso, nao como falha de dado', () => {
    const result = dateSequenceCheck({
      processData: {
        status: 'completed',
        etd: '2025-05-01',
        eta: '2025-06-01',
        shipmentDate: '2025-05-02',
      },
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('nao prova divergencia');
  });

  it('mantem inversao cronologica como falha', () => {
    const result = dateSequenceCheck({
      invoiceData: { invoiceDate: '2026-04-10' },
      processData: { shipmentDate: '2026-04-01', eta: '2026-05-01' },
    });

    expect(result.status).toBe('failed');
    expect(result.message).toContain('posterior a data de embarque');
  });

  // Regressão: o parser local usava `new Date(value)` (MM/DD no JS) enquanto
  // date-compare interpreta DMY. A MESMA string '04/03/2026' virava 2026-04-03
  // aqui e 2026-03-04 lá — e como inversão cronológica é `failed`, o artefato
  // de parsing produzia FALHA DURA num processo consistente.
  it('le DD/MM como date-compare e nao gera falha dura por artefato de parsing', () => {
    const result = dateSequenceCheck({
      invoiceData: { invoiceDate: '04/03/2026' },
      processData: { shipmentDate: '2026-03-05', eta: '2026-04-01' },
    });

    expect(result.status).toBe('passed');
    expect(result.actualValue).toContain('INV=2026-03-04');
  });

  it('usa o mesmo parser de date-compare para a mesma string', () => {
    const result = dateSequenceCheck({
      invoiceData: { invoiceDate: '03/04/2026' },
      processData: { shipmentDate: '2026-04-20', eta: '2026-05-01' },
    });

    expect(parseDate('03/04/2026')?.toISOString().slice(0, 10)).toBe('2026-04-03');
    expect(result.actualValue).toContain('INV=2026-04-03');
  });

  it('ignora a sentinela legada 01/01/1900 em vez de trata-la como data real', () => {
    const result = dateSequenceCheck({
      invoiceData: { invoiceDate: '01/01/1900' },
      processData: { shipmentDate: '01/01/1900' },
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('Nenhuma data encontrada');
  });
});
