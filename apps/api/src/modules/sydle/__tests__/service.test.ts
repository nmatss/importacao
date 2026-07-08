import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';

const { mockDb, mockTx, queryQueue } = createMockDb();
mockDb.execute = vi.fn();

vi.mock('../../../shared/database/connection.js', () => ({
  db: mockDb,
}));

vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../audit/service.js', () => ({
  auditService: { log: vi.fn() },
}));

vi.mock('../../alerts/service.js', () => ({
  alertService: { create: vi.fn().mockResolvedValue(undefined) },
}));

const { sydleService, tagSydleFinancialSources } = await import('../service.js');
type NormalizedPayment = Parameters<typeof sydleService.upsertPayments>[0][number];

describe('tagSydleFinancialSources', () => {
  const base = {
    exchangeRate: null as string | null,
    amountBrl: null as string | null,
  };

  it('keeps SYDLE values untouched and tags them as sydle', () => {
    const out = tagSydleFinancialSources({
      ...base,
      exchangeRate: '5.20',
      amountBrl: '5200.00',
    });
    expect(out.exchangeRate).toBe('5.20');
    expect(out.amountBrl).toBe('5200.00');
    expect(out.exchangeRateSource).toBe('sydle');
    expect(out.amountBrlSource).toBe('sydle');
  });

  it('does not invent financial values when SYDLE leaves them empty', () => {
    const out = tagSydleFinancialSources({ ...base });
    expect(out.exchangeRate).toBeNull();
    expect(out.amountBrl).toBeNull();
    expect(out.exchangeRateSource).toBeNull();
    expect(out.amountBrlSource).toBeNull();
  });
});

function makePayment(overrides: Partial<NormalizedPayment> = {}): NormalizedPayment {
  return {
    externalId: 'PAY-1',
    sydleProtocol: null,
    processCode: null,
    purchaseRef: null,
    purchaseOrder: null,
    proformaNumber: null,
    invoiceNumber: null,
    supplierName: null,
    brand: null,
    currency: 'USD',
    purchaseAmount: null,
    paidAmount: null,
    openAmount: null,
    paymentType: 'balance',
    paymentStatus: 'open',
    dueDate: null,
    invoiceIssuedDate: null,
    taskCreatedAt: null,
    shipmentDate: null,
    paymentDeadlineAfterShipment: null,
    exceptionStatus: null,
    exceptionReason: null,
    paidAt: null,
    scheduledAt: null,
    exchangeRate: null,
    amountBrl: null,
    bankName: null,
    contractNumber: null,
    remittanceId: null,
    sourceUpdatedAt: null,
    rawPayload: {},
    ...overrides,
  };
}

describe('sydleService', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
    mockTx.execute.mockResolvedValue([]);
    process.env = { ...originalEnv, SYDLE_SYNC_ENABLED: 'false' };
  });

  it('records skipped sync when SYDLE is not configured', async () => {
    const started = { id: 10, status: 'running', trigger: 'cron' };
    const completed = {
      id: 10,
      status: 'skipped',
      fetched: 0,
      created: 0,
      updated: 0,
      matched: 0,
      unmatched: 0,
      errors: 0,
    };

    queryQueue.push(createResolvedChain([started]));
    queryQueue.push(createResolvedChain([completed]));

    const result = await sydleService.sync('cron', null);

    expect(result).toEqual(completed);
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it('records skipped sync when another SYDLE sync owns the advisory lock', async () => {
    const started = { id: 11, status: 'running', trigger: 'manual' };
    const completed = {
      id: 11,
      status: 'skipped',
      fetched: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      matched: 0,
      unmatched: 0,
      errors: 0,
      metadata: { skippedReason: 'sync_already_running' },
    };

    process.env = {
      ...originalEnv,
      SYDLE_SYNC_ENABLED: 'true',
      SYDLE_BASE_URL: 'https://sydle.example.test',
      SYDLE_API_TOKEN: 'token',
    };
    mockTx.execute.mockResolvedValueOnce([{ acquired: false }]);
    queryQueue.push(createResolvedChain([started]));
    queryQueue.push(createResolvedChain([completed]));

    const result = await sydleService.sync('manual', 1);

    expect(result).toEqual(completed);
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.execute).toHaveBeenCalledTimes(1);
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('matches a payment by exact process code', async () => {
    queryQueue.push(
      createResolvedChain([
        {
          id: 264,
          processCode: 'IM0712602NB',
          purchaseRef: null,
          brand: 'puket',
          exporterName: 'KIOM GLOBAL LIMITED',
          totalFobValue: '24312.52',
          aiExtractedData: null,
        },
      ]),
    );

    const result = await sydleService.matchProcess(
      makePayment({
        processCode: 'IM0712602NB',
        purchaseAmount: 24312.52,
      }),
    );

    expect(result).toEqual({
      processId: 264,
      matchStatus: 'matched',
      matchScore: 1,
      matchReason: 'process_code',
    });
  });

  it('keeps the stored cursor on source updatedAt and applies overlap only to requests', () => {
    const previousCursor = new Date('2026-06-18T10:00:00Z');
    const cursorFrom = sydleService.applyCursorOverlap(previousCursor);
    const cursorTo = sydleService.resolveCursorTo(previousCursor, [
      makePayment({ sourceUpdatedAt: new Date('2026-06-18T09:59:00Z') }),
      makePayment({ sourceUpdatedAt: new Date('2026-06-18T10:10:00Z') }),
    ]);

    expect(cursorFrom?.toISOString()).toBe('2026-06-18T09:55:00.000Z');
    expect(cursorTo?.toISOString()).toBe('2026-06-18T10:10:00.000Z');
  });

  it('does not advance cursor when SYDLE omits source updatedAt on the first sync', () => {
    expect(sydleService.resolveCursorTo(null, [makePayment()])).toBeNull();
  });

  it('matches a payment by proforma, invoice, and purchase order lookup values', async () => {
    queryQueue.push(
      createResolvedChain([
        {
          id: 265,
          processCode: 'IM0712603NB',
          purchaseRef: null,
          brand: 'puket',
          exporterName: 'KIOM GLOBAL LIMITED',
          totalFobValue: '24312.52',
          aiExtractedData: {
            proformaNumber: 'PI-777',
            invoiceNumber: 'INV-101',
            purchaseOrder: 'PO-55',
          },
        },
      ]),
    );

    const result = await sydleService.matchProcess(
      makePayment({
        purchaseOrder: 'PO-55',
        proformaNumber: 'PI-777',
        invoiceNumber: 'INV-101',
        supplierName: 'KIOM GLOBAL LIMITED',
        brand: 'Puket',
        purchaseAmount: 24312.52,
      }),
    );

    expect(result).toMatchObject({
      processId: 265,
      matchStatus: 'matched',
    });
    expect(result.matchReason).toContain('purchase_order');
    expect(result.matchReason).toContain('proforma');
    expect(result.matchReason).toContain('invoice');
  });

  it('matches lookup values nested inside extracted document payloads', async () => {
    queryQueue.push(
      createResolvedChain([
        {
          id: 268,
          processCode: 'IM0712606NB',
          purchaseRef: null,
          brand: 'puket',
          exporterName: 'KIOM GLOBAL LIMITED',
          totalFobValue: '24312.52',
          aiExtractedData: {
            proforma_invoice: {
              piNumber: { value: 'PI-NESTED', confidence: 0.94 },
            },
            invoice: {
              invoiceNumber: { value: 'INV-NESTED', confidence: 0.93 },
            },
            metadata: {
              purchaseOrder: 'PO-NESTED',
            },
          },
        },
      ]),
    );

    const result = await sydleService.matchProcess(
      makePayment({
        purchaseOrder: 'PO-NESTED',
        proformaNumber: 'PI-NESTED',
        invoiceNumber: 'INV-NESTED',
        supplierName: 'KIOM GLOBAL LIMITED',
        brand: 'Puket',
        purchaseAmount: 24312.52,
      }),
    );

    expect(result).toMatchObject({
      processId: 268,
      matchStatus: 'matched',
    });
    expect(result.matchReason).toContain('purchase_order');
    expect(result.matchReason).toContain('proforma');
    expect(result.matchReason).toContain('invoice');
  });

  it('does not auto-match when invoice is the only evidence', async () => {
    queryQueue.push(
      createResolvedChain([
        {
          id: 266,
          processCode: 'IM0712604NB',
          purchaseRef: null,
          brand: 'puket',
          exporterName: 'KIOM GLOBAL LIMITED',
          totalFobValue: '24312.52',
          aiExtractedData: {
            invoiceNumber: 'INV-ONLY',
          },
        },
      ]),
    );

    const result = await sydleService.matchProcess(makePayment({ invoiceNumber: 'INV-ONLY' }));

    expect(result).toMatchObject({
      processId: null,
      matchStatus: 'unmatched',
      matchScore: 0.45,
      matchReason: 'invoice',
    });
  });

  it('matches invoice lookup when supported by supplier, brand, and value evidence', async () => {
    queryQueue.push(
      createResolvedChain([
        {
          id: 267,
          processCode: 'IM0712605NB',
          purchaseRef: null,
          brand: 'puket',
          exporterName: 'KIOM GLOBAL LIMITED',
          totalFobValue: '24312.52',
          aiExtractedData: {
            invoiceNumber: 'INV-101',
          },
        },
      ]),
    );

    const result = await sydleService.matchProcess(
      makePayment({
        invoiceNumber: 'INV-101',
        supplierName: 'KIOM GLOBAL LIMITED',
        brand: 'Puket',
        purchaseAmount: 24312.52,
      }),
    );

    expect(result).toMatchObject({
      processId: 267,
      matchStatus: 'matched',
    });
    expect(result.matchReason).toContain('invoice');
    expect(result.matchReason).toContain('supplier');
    expect(result.matchReason).toContain('brand');
    expect(result.matchReason).toContain('amount');
  });

  it('exports CSV by paginating all matching rows', async () => {
    const listSpy = vi.spyOn(sydleService, 'list');
    listSpy
      .mockResolvedValueOnce({
        data: [
          {
            processCode: 'IM1',
            portalProcessCode: null,
            purchaseRef: 'C1',
            purchaseOrder: null,
            proformaNumber: null,
            invoiceNumber: null,
            supplierName: 'Supplier 1',
            brand: 'puket',
            portalBrand: null,
            currency: 'USD',
            purchaseAmount: '10.00',
            paidAmount: '0.00',
            openAmount: '10.00',
            paymentType: 'deposit',
            paymentStatus: 'open',
            dueDate: null,
            paidAt: null,
            exchangeRate: null,
            amountBrl: null,
            matchStatus: 'matched',
            matchReason: 'purchase_ref',
            sourceUpdatedAt: null,
            syncedAt: null,
          } as any,
        ],
        total: 2,
        page: 1,
        limit: 200,
      })
      .mockResolvedValueOnce({
        data: [
          {
            processCode: 'IM2',
            portalProcessCode: null,
            purchaseRef: 'C2',
            purchaseOrder: null,
            proformaNumber: null,
            invoiceNumber: null,
            supplierName: 'Supplier 2',
            brand: 'imaginarium',
            portalBrand: null,
            currency: 'USD',
            purchaseAmount: '20.00',
            paidAmount: '20.00',
            openAmount: '0.00',
            paymentType: 'balance',
            paymentStatus: 'paid',
            dueDate: null,
            paidAt: null,
            exchangeRate: null,
            amountBrl: null,
            matchStatus: 'matched',
            matchReason: 'invoice',
            sourceUpdatedAt: null,
            syncedAt: null,
          } as any,
        ],
        total: 2,
        page: 2,
        limit: 200,
      });

    const csv = await sydleService.exportCsv({
      page: 1,
      limit: 50,
      sortBy: 'dueDate',
      sortOrder: 'asc',
    });

    expect(listSpy).toHaveBeenCalledTimes(2);
    expect(listSpy).toHaveBeenNthCalledWith(1, expect.objectContaining({ page: 1, limit: 200 }));
    expect(listSpy).toHaveBeenNthCalledWith(2, expect.objectContaining({ page: 2, limit: 200 }));
    expect(csv).toContain('"IM1"');
    expect(csv).toContain('"IM2"');

    listSpy.mockRestore();
  });

  it('exports the filtered report as XLSX', async () => {
    const listSpy = vi.spyOn(sydleService, 'list').mockResolvedValueOnce({
      data: [
        {
          processCode: 'IM1',
          portalProcessCode: null,
          logisticStatus: 'in_transit',
          purchaseRef: 'C1',
          purchaseOrder: null,
          proformaNumber: 'PI-1',
          invoiceNumber: 'INV-1',
          supplierName: 'Supplier 1',
          brand: 'puket',
          portalBrand: null,
          currency: 'USD',
          purchaseAmount: '10.00',
          paidAmount: '0.00',
          openAmount: '10.00',
          paymentType: 'deposit',
          paymentStatus: 'open',
          dueDate: '2026-06-10',
          paidAt: null,
          scheduledAt: null,
          exchangeRate: null,
          exchangeRateSource: null,
          amountBrl: null,
          amountBrlSource: null,
          bankName: null,
          contractNumber: null,
          remittanceId: null,
          matchStatus: 'matched',
          matchReason: 'process_code',
          sourceUpdatedAt: null,
          syncedAt: null,
        } as any,
      ],
      total: 1,
      page: 1,
      limit: 200,
    });

    const xlsx = await sydleService.exportXlsx({
      page: 1,
      limit: 50,
      sortBy: 'dueDate',
      sortOrder: 'asc',
    });

    expect(xlsx.subarray(0, 2).toString()).toBe('PK');
    expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 200 }));

    listSpy.mockRestore();
  });

  it('exports the filtered report as PDF', async () => {
    const listSpy = vi.spyOn(sydleService, 'list').mockResolvedValueOnce({
      data: [
        {
          processCode: 'IM1',
          portalProcessCode: null,
          logisticStatus: 'in_transit',
          purchaseRef: 'C1',
          purchaseOrder: null,
          supplierName: 'Supplier 1',
          currency: 'USD',
          purchaseAmount: '10.00',
          paidAmount: '0.00',
          openAmount: '10.00',
          paymentStatus: 'open',
          dueDate: '2026-06-10',
          bankName: 'Banco',
          contractNumber: 'CON-1',
          matchStatus: 'matched',
        } as any,
      ],
      total: 1,
      page: 1,
      limit: 200,
    });

    const pdf = await sydleService.exportPdf({
      page: 1,
      limit: 50,
      sortBy: 'dueDate',
      sortOrder: 'asc',
    });

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString()).toContain('/BaseFont /Helvetica');

    listSpy.mockRestore();
  });
});
