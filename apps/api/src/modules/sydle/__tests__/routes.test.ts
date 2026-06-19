import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authGate = vi.hoisted(() => ({ adminAllowed: true }));
const serviceMock = vi.hoisted(() => ({
  getConfigStatus: vi.fn(),
  list: vi.fn(),
  summary: vi.fn(),
  exportCsv: vi.fn(),
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

  it('requires admin access for the SYDLE report API', async () => {
    authGate.adminAllowed = false;

    const res = await request(makeApp()).get('/api/sydle/payments-report');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ success: false, error: 'Acesso negado' });
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

  it('runs manual sync with the authenticated admin user id', async () => {
    serviceMock.sync.mockResolvedValueOnce({ id: 99, status: 'success' });

    const res = await request(makeApp()).post('/api/sydle/sync-now');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: 99, status: 'success' });
    expect(serviceMock.sync).toHaveBeenCalledWith('manual', 1);
  });
});
