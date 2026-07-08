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

  it('extracts Sydle One _search hits and keeps the hit id', () => {
    const records = extractSydleRecords({
      hits: {
        hits: [
          {
            _id: 'REQ-1',
            _source: {
              _lastUpdateDate: '2026-06-18T20:20:31.914Z',
              paymentData: [{ _id: 'PAY-1' }],
            },
          },
        ],
      },
    });

    expect(records).toEqual([
      {
        _id: 'REQ-1',
        _lastUpdateDate: '2026-06-18T20:20:31.914Z',
        paymentData: [{ _id: 'PAY-1' }],
      },
    ]);
  });

  it('normalizes flattened Sydle One international payment rows', () => {
    const result = normalizeSydlePayment({
      externalId: 'sydle-one:REQ-1:PAY-1',
      purchaseRef: 'SYDLE-5337',
      currency: 'USD',
      purchaseAmount: 4460,
      paidAmount: 0,
      openAmount: 4460,
      paymentType: 'balance',
      paymentStatus: 'open',
      dueDate: '2026-06-18T00:00:00Z',
      sourceUpdatedAt: '2026-06-18T20:20:31.914Z',
      rawSydleOne: {
        request: { _id: 'REQ-1' },
        ticket: { code: '5337' },
        payment: { _id: 'PAY-1' },
      },
    });

    expect(result).toMatchObject({
      externalId: 'sydle-one:REQ-1:PAY-1',
      purchaseRef: 'SYDLE-5337',
      currency: 'USD',
      purchaseAmount: 4460,
      paidAmount: 0,
      openAmount: 4460,
      paymentType: 'balance',
      paymentStatus: 'open',
      dueDate: '2026-06-18',
    });
    expect(result.sourceUpdatedAt?.toISOString()).toBe('2026-06-18T20:20:31.914Z');
  });

  it('normalizes raw Sydle One report aliases from requestData', () => {
    const result = normalizeSydlePayment({
      externalId: 'sydle-one:REQ-5317:PAY-1',
      sydleProtocol: '5317',
      processCode: 'IM0742605SZ',
      invoiceCode: 'IM0742605SZ',
      paymentType: 'afterShipment',
      emissionDate: '2026-05-07T00:00:00Z',
      endDateForm: '2026-06-16T12:39:04Z',
      departureDate: '2026-05-07T00:00:00Z',
      paymentDeadlineAfterShipment: 7,
      currency: 'USD',
      purchaseAmount: 5887.39,
      dueDate: '2026-06-17T00:00:00Z',
    });

    expect(result).toMatchObject({
      sydleProtocol: '5317',
      processCode: 'IM0742605SZ',
      invoiceNumber: 'IM0742605SZ',
      paymentType: 'balance_after_shipment',
      invoiceIssuedDate: '2026-05-07',
      shipmentDate: '2026-05-07',
      paymentDeadlineAfterShipment: 7,
    });
    expect(result.taskCreatedAt?.toISOString()).toBe('2026-06-16T12:39:04.000Z');
  });

  it('normalizes the SYDLE Analytics CSV columns without collapsing installments', () => {
    const first = normalizeSydlePayment({
      Protocolo: '5317',
      'Número Invoice': 'IM0742605SZ',
      'Beneficiário ': 'KIOM GLOBAL LIMITED',
      Marca: 'Imaginarium',
      'Tipo de pagamento ': 'Balance after Shipment',
      'Data de vencimento ': '17/06/2026',
      'Moeda de pagamento': 'Dólar / $',
      'Valor a Pagar': '2.024,06',
      'Data de emissão Invoice/PI ': '07/05/2026',
      'Data criação da tarefa ': '16/06/2026 09:39',
      Exceção: '(vazio)',
      'Motivo da exceção': '(vazio)',
      'Código do processo': 'IM0742605SZ',
      'Data de embarque': '07/05/2026',
      'Prazo para pagamento pós embarque': '0',
      'Data da última alteração': '01/07/2026',
    });
    const second = normalizeSydlePayment({
      Protocolo: '5317',
      'Número Invoice': 'IM0742605SZ',
      'Data de vencimento ': '17/06/2026',
      'Moeda de pagamento': 'Dólar / $',
      'Valor a Pagar': '4.667,04',
      'Prazo para pagamento pós embarque': '30',
    });

    expect(first).toMatchObject({
      sydleProtocol: '5317',
      invoiceNumber: 'IM0742605SZ',
      supplierName: 'KIOM GLOBAL LIMITED',
      brand: 'imaginarium',
      paymentType: 'balance_after_shipment',
      dueDate: '2026-06-17',
      currency: 'USD',
      purchaseAmount: 2024.06,
      invoiceIssuedDate: '2026-05-07',
      shipmentDate: '2026-05-07',
      paymentDeadlineAfterShipment: 0,
      exceptionStatus: null,
      exceptionReason: null,
      processCode: 'IM0742605SZ',
    });
    expect(first.taskCreatedAt?.toISOString()).toBe('2026-06-16T09:39:00.000Z');
    expect(first.sourceUpdatedAt?.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(first.externalId).toMatch(/^sydle-report:/);
    expect(second.externalId).toMatch(/^sydle-report:/);
    expect(second.externalId).not.toBe(first.externalId);
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
