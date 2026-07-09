import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authGate = vi.hoisted(() => ({
  role: 'analyst',
  id: 42,
  email: 'operadora@grupounico.com',
}));

vi.mock('../../../shared/middleware/auth.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: authGate.id, email: authGate.email, role: authGate.role };
    next();
  },
  adminMiddleware: (req: any, res: any, next: any) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ success: false });
    next();
  },
}));

vi.mock('../../../shared/middleware/validate.js', () => ({
  validate: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../../shared/middleware/rate-limit.js', () => ({
  createRateLimiter: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../controller.js', () => ({
  authController: {
    login: vi.fn(),
    loginWithGoogle: vi.fn(),
    getMe: vi.fn(),
    listUsers: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    deleteUser: vi.fn(),
  },
}));

const { authRoutes } = await import('../routes.js');
const { canAccessCertApi, requiredCertApiScope } = await import('../cert-api-access.js');

function makeApp() {
  const app = express();
  app.use('/api/auth', authRoutes);
  return app;
}

function certAccessRequest(method: string, uri?: string) {
  const req = request(makeApp())
    .get('/api/auth/cert-api-access')
    .set('X-Cert-Original-Method', method);
  if (uri) req.set('X-Cert-Original-URI', uri);
  return req;
}

describe('cert-api gateway access policy', () => {
  beforeEach(() => {
    authGate.role = 'analyst';
    authGate.id = 42;
    authGate.email = 'operadora@grupounico.com';
    vi.clearAllMocks();
  });

  it('classifies the analyst allowlist and defaults unknown routes to cert.admin', () => {
    expect(requiredCertApiScope('GET', '/cert-api/api/stats?brand=puket')).toBe('cert.read');
    expect(requiredCertApiScope('GET', '/cert-api/api/products/SKU-123')).toBe('cert.read');
    expect(requiredCertApiScope('GET', '/cert-api/api/certificates/cert-1/pdf')).toBe('cert.read');
    expect(requiredCertApiScope('GET', '/cert-api/api/schedules/schedule-1/history')).toBe(
      'cert.read',
    );
    expect(requiredCertApiScope('POST', '/cert-api/api/validate')).toBe('cert.operate');
    expect(requiredCertApiScope('POST', '/cert-api/api/reports/export-stock')).toBe('cert.operate');

    expect(requiredCertApiScope('POST', '/cert-api/api/sync-stock')).toBe('cert.admin');
    expect(requiredCertApiScope('POST', '/cert-api/api/certificates')).toBe('cert.admin');
    expect(requiredCertApiScope('GET', '/cert-api/api/products%2Fverify')).toBe('cert.admin');
    expect(requiredCertApiScope(undefined, undefined)).toBe('cert.admin');
  });

  it('allows analysts only cert.read and cert.operate scopes', () => {
    expect(canAccessCertApi('analyst', 'cert.read')).toBe(true);
    expect(canAccessCertApi('analyst', 'cert.operate')).toBe(true);
    expect(canAccessCertApi('analyst', 'cert.admin')).toBe(false);
    expect(canAccessCertApi(undefined, 'cert.read')).toBe(false);
  });

  it.each([
    ['GET', '/cert-api/api/stats'],
    ['GET', '/cert-api/api/products/SKU-123'],
    ['GET', '/cert-api/api/validate/run-123/stream'],
    ['GET', '/cert-api/api/certificates'],
    ['POST', '/cert-api/api/validate'],
    ['POST', '/cert-api/api/products/verify'],
    ['POST', '/cert-api/api/reports/export'],
    ['POST', '/cert-api/api/reports/export-stock'],
  ])('allows analyst access to %s %s and returns trusted actor identity', async (method, uri) => {
    const res = await certAccessRequest(method, uri);

    expect(res.status).toBe(204);
    expect(res.headers['x-cert-actor-id']).toBe('42');
    expect(res.headers['x-cert-actor-email']).toBe('operadora@grupounico.com');
    expect(res.headers['x-cert-actor-role']).toBe('analyst');
  });

  it.each([
    ['POST', '/cert-api/api/sync-sheets'],
    ['POST', '/cert-api/api/sync-stock'],
    ['POST', '/cert-api/api/sync-licenciados'],
    ['POST', '/cert-api/api/certificates'],
    ['POST', '/cert-api/api/certificates/cert-1/retry-linx'],
    ['DELETE', '/cert-api/api/schedules/schedule-1'],
    ['GET', '/cert-api/api/not-yet-classified'],
  ])('denies analyst access to %s %s', async (method, uri) => {
    const res = await certAccessRequest(method, uri);

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ success: false });
  });

  it('fails closed for an auth request without the original URI', async () => {
    const res = await certAccessRequest('GET');

    expect(res.status).toBe(403);
  });

  it('allows administrators through every scope', async () => {
    authGate.role = 'admin';

    const res = await certAccessRequest('POST', '/cert-api/api/certificates/cert-1/retry-linx');

    expect(res.status).toBe(204);
    expect(res.headers['x-cert-actor-role']).toBe('admin');
  });
});
