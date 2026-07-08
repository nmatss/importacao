import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authGate = vi.hoisted(() => ({ adminAllowed: true }));
const serviceMock = vi.hoisted(() => ({
  getConfigStatus: vi.fn(),
  list: vi.fn(),
  summary: vi.fn(),
  getPaymentById: vi.fn(),
  exportCsv: vi.fn(),
  exportXlsx: vi.fn(),
  exportPdf: vi.fn(),
  sync: vi.fn(),
  getSyncRuns: vi.fn(),
}));

vi.mock('../../../shared/middleware/auth.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 1, role: authGate.adminAllowed ? 'admin' : 'analyst' };
    next();
  },
  adminMiddleware: (_req: any, res: any, next: any) => {
    if (!authGate.adminAllowed) {
      return res.status(403).json({ success: false, error: 'Acesso negado' });
    }
    next();
  },
}));

vi.mock('../../../shared/middleware/rate-limit.js', () => ({
  createRateLimiter: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../service.js', () => ({
  sydleService: serviceMock,
}));

const { sydleRoutes } = await import('../routes.js');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sydle', sydleRoutes);
  return app;
}

describe('sydleRoutes', () => {
  beforeEach(() => {
    authGate.adminAllowed = true;
    vi.clearAllMocks();
  });

  it('allows analyst users to read the SYDLE report API', async () => {
    authGate.adminAllowed = false;
    serviceMock.list.mockResolvedValueOnce({
      data: [{ processCode: 'IM0712602NB', paymentStatus: 'open' }],
      total: 1,
      page: 1,
      limit: 50,
    });

    const res = await request(makeApp()).get('/api/sydle/payments-report');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(serviceMock.list).toHaveBeenCalled();
  });

  it('removes raw payload from detail responses for analyst users', async () => {
    authGate.adminAllowed = false;
    serviceMock.getPaymentById.mockResolvedValueOnce({
      id: 10,
      invoiceNumber: 'INV-1',
      rawPayload: { rawSydleOne: { request: { id: 'REQ-1' } } },
    });

    const res = await request(makeApp()).get('/api/sydle/payments-report/10');

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: 10, invoiceNumber: 'INV-1', rawPayload: null });
  });

  it('lists payments using validated report filters', async () => {
    serviceMock.list.mockResolvedValueOnce({
      data: [{ processCode: 'IM0712602NB', paymentStatus: 'open' }],
      total: 1,
      page: 1,
      limit: 25,
    });

    const res = await request(makeApp()).get(
      '/api/sydle/payments-report?brand=puket&paymentStatus=open&limit=25',
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.pagination).toMatchObject({ total: 1, page: 1, limit: 25, pages: 1 });
    expect(serviceMock.list).toHaveBeenCalledWith(
      expect.objectContaining({ brand: 'puket', paymentStatus: 'open', limit: 25 }),
    );
  });

  it('exports CSV with download and sniffing headers', async () => {
    serviceMock.exportCsv.mockResolvedValueOnce('"Processo","Status"\n"IM0712602NB","open"');

    const res = await request(makeApp()).get('/api/sydle/payments-report/export.csv?brand=puket');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('sydle-compras-pagamentos-');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.text.charCodeAt(0)).toBe(0xfeff);
    expect(res.text).toContain('"IM0712602NB"');
    expect(serviceMock.exportCsv).toHaveBeenCalledWith(
      expect.objectContaining({ brand: 'puket', page: 1, limit: 200 }),
    );
  });

  it('exports XLSX with download and sniffing headers', async () => {
    serviceMock.exportXlsx.mockResolvedValueOnce(Buffer.from('PK\x03\x04xlsx'));

    const res = await request(makeApp()).get('/api/sydle/payments-report/export.xlsx?brand=puket');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.headers['content-disposition']).toContain('sydle-compras-pagamentos-');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(serviceMock.exportXlsx).toHaveBeenCalledWith(
      expect.objectContaining({ brand: 'puket', page: 1, limit: 200 }),
    );
  });

  it('exports PDF with download and sniffing headers', async () => {
    serviceMock.exportPdf.mockResolvedValueOnce(Buffer.from('%PDF-1.4'));

    const res = await request(makeApp()).get('/api/sydle/payments-report/export.pdf?brand=puket');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('sydle-compras-pagamentos-');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(serviceMock.exportPdf).toHaveBeenCalledWith(
      expect.objectContaining({ brand: 'puket', page: 1, limit: 200 }),
    );
  });

  it('runs manual sync with the authenticated admin user id', async () => {
    serviceMock.sync.mockResolvedValueOnce({ id: 99, status: 'success' });

    const res = await request(makeApp()).post('/api/sydle/sync-now');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: 99, status: 'success' });
    expect(serviceMock.sync).toHaveBeenCalledWith('manual', 1, { full: false });
  });

  it('keeps manual sync restricted to admin users', async () => {
    authGate.adminAllowed = false;

    const res = await request(makeApp()).post('/api/sydle/sync-now');

    expect(res.status).toBe(403);
    expect(serviceMock.sync).not.toHaveBeenCalled();
  });

  it('keeps sync runs restricted to admin users', async () => {
    authGate.adminAllowed = false;

    const res = await request(makeApp()).get('/api/sydle/sync-runs');

    expect(res.status).toBe(403);
    expect(serviceMock.getSyncRuns).not.toHaveBeenCalled();
  });

  it('runs a full manual sync when requested by the admin', async () => {
    serviceMock.sync.mockResolvedValueOnce({
      id: 100,
      status: 'success',
      metadata: { fullResync: true },
    });

    const res = await request(makeApp()).post('/api/sydle/sync-now?full=1');

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: 100, status: 'success' });
    expect(serviceMock.sync).toHaveBeenCalledWith('manual', 1, { full: true });
  });
});
