import { describe, expect, it } from 'vitest';
import {
  extractSydleRecords,
  normalizeSydlePayment,
  parseSydleDateTime,
  parseSydleNumber,
  sanitizeSydleRawPayload,
} from '../normalizer.js';

describe('SYDLE payment normalizer', () => {
  it.each([
    ['24.312,52', 24312.52],
    ['24,312.52', 24312.52],
    ['R$ 120.050,90', 120050.9],
    ['USD 120,050.90', 120050.9],
    ['', null],
  ])('parses locale number %s', (input, expected) => {
    expect(parseSydleNumber(input)).toBe(expected);
  });

  it('normalizes Portuguese purchase/payment fields', () => {
    const result = normalizeSydlePayment({
      codigoPagamento: 'PAY-123',
      processo: 'IM0712602NB',
      compra: 'C-9981',
      pedidoCompra: 'PO-55',
      numeroPi: 'PI-777',
      numeroInvoice: 'INV-101',
      fornecedor: 'KIOM GLOBAL LIMITED',
      marca: 'Puket',
      moeda: 'US$',
      valorCompra: '24.312,52',
      valorPago: '7.293,76',
      tipoPagamento: 'Sinal',
      statusPagamento: 'Agendado',
      vencimento: '22/06/2026',
      dataAgendada: '2026-06-20',
      taxaCambio: '5,4321',
      valorBrl: '39.620,12',
      ultimaAtualizacao: '2026-06-18T10:30:00Z',
    });

    expect(result).toMatchObject({
      externalId: 'PAY-123',
      processCode: 'IM0712602NB',
      purchaseRef: 'C-9981',
      purchaseOrder: 'PO-55',
      proformaNumber: 'PI-777',
      invoiceNumber: 'INV-101',
      supplierName: 'KIOM GLOBAL LIMITED',
      brand: 'puket',
      currency: 'USD',
      purchaseAmount: 24312.52,
      paidAmount: 7293.76,
      openAmount: 17018.76,
      paymentType: 'deposit',
      paymentStatus: 'scheduled',
      dueDate: '2026-06-22',
      exchangeRate: 5.4321,
      amountBrl: 39620.12,
    });
    expect(result.scheduledAt?.toISOString().slice(0, 10)).toBe('2026-06-20');
    expect(result.sourceUpdatedAt?.toISOString()).toBe('2026-06-18T10:30:00.000Z');
  });

  it('keeps explicit external IDs from SYDLE when present', () => {
    const result = normalizeSydlePayment({
      codigoPagamento: 'PAY-STABLE-123',
      processo: 'IM0712602NB',
      numeroPi: 'PI-777',
      statusPagamento: 'Aberto',
    });

    expect(result.externalId).toBe('PAY-STABLE-123');
  });

  it('derives a stable fallback external ID from business references', () => {
    const first = normalizeSydlePayment({
      processo: 'IM0712602NB',
      numeroPi: 'PI-777',
      tipoPagamento: 'Sinal',
      vencimento: '22/06/2026',
      fornecedor: 'KIOM GLOBAL LIMITED',
      marca: 'Puket',
      valorCompra: '24.312,52',
      statusPagamento: 'Aberto',
    });
    const updated = normalizeSydlePayment({
      processo: 'IM0712602NB',
      numeroPi: 'PI-777',
      tipoPagamento: 'Sinal',
      vencimento: '25/06/2026',
      fornecedor: 'KIOM Global Ltd',
      marca: 'Puket Escolares',
      valorCompra: '25.000,00',
      valorPago: '25.000,00',
      statusPagamento: 'Pago',
    });

    expect(first.externalId).toMatch(/^derived:/);
    expect(updated.externalId).toBe(first.externalId);
  });

  it('falls back to payload hash when SYDLE omits every business reference', () => {
    const result = normalizeSydlePayment({
      fornecedor: 'KIOM GLOBAL LIMITED',
      valorCompra: '24.312,52',
    });

    expect(result.externalId).toMatch(/^hash:/);
  });

  it('parses Brazilian date-time values without losing the time component', () => {
    const parsed = parseSydleDateTime('18/06/2026 10:10:00');
    const result = normalizeSydlePayment({
      codigoPagamento: 'PAY-BR-DATE',
      ultimaAtualizacao: '18/06/2026 10:10:00',
    });

    expect(parsed?.toISOString()).toBe('2026-06-18T10:10:00.000Z');
    expect(result.sourceUpdatedAt?.toISOString()).toBe('2026-06-18T10:10:00.000Z');
  });

  it('extracts array payloads from common API envelopes', () => {
    expect(extractSydleRecords({ data: [{ id: 1 }, { id: 2 }] })).toHaveLength(2);
    expect(extractSydleRecords({ results: [{ id: 1 }] })).toHaveLength(1);
    expect(extractSydleRecords([{ id: 1 }])).toHaveLength(1);
  });

  it('redacts sensitive keys from raw payload snapshots', () => {
    const result = normalizeSydlePayment({
      codigoPagamento: 'PAY-123',
      invoice: 'INV-101',
      apiToken: 'secret-token',
      nested: {
        conta: '12345-6',
        keep: 'visible',
        items: [{ authorization: 'Bearer abc' }],
      },
    });

    expect(result.rawPayload).toMatchObject({
      codigoPagamento: 'PAY-123',
      invoice: 'INV-101',
      apiToken: '[REDACTED]',
      nested: {
        conta: '[REDACTED]',
        keep: 'visible',
        items: [{ authorization: '[REDACTED]' }],
      },
    });
  });

  it('sanitizes raw payloads without mutating the source object', () => {
    const source = { token: 'secret', keep: 'ok' };
    const sanitized = sanitizeSydleRawPayload(source);

    expect(sanitized).toEqual({ token: '[REDACTED]', keep: 'ok' });
    expect(source).toEqual({ token: 'secret', keep: 'ok' });
  });
});
