import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';

const { mockDb, queryQueue } = createMockDb();

vi.mock('../../database/connection.js', () => ({ db: mockDb }));

const { mockVerify } = vi.hoisted(() => ({ mockVerify: vi.fn() }));

vi.mock('jsonwebtoken', () => ({
  default: { verify: (...args: any[]) => mockVerify(...args) },
}));

process.env.JWT_SECRET = 'test-secret';

const { authMiddleware, adminMiddleware } = await import('../auth.js');

function makeApp() {
  const app = express();
  app.get('/protegido', authMiddleware, (req, res) => {
    res.json({ user: req.user });
  });
  app.get('/admin', authMiddleware, adminMiddleware, (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe('authMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
  });

  it('fixa o algoritmo HS256 na verificacao do token', async () => {
    mockVerify.mockReturnValue({ id: 1, email: 'a@grupounico.com', role: 'admin' });
    queryQueue.push(
      createResolvedChain([{ id: 1, email: 'a@grupounico.com', role: 'admin', isActive: true }]),
    );

    const res = await request(makeApp()).get('/protegido').set('Authorization', 'Bearer tok');

    expect(res.status).toBe(200);
    // Pin defensivo: o token nunca escolhe o algoritmo de verificacao.
    expect(mockVerify).toHaveBeenCalledWith('tok', 'test-secret', { algorithms: ['HS256'] });
  });

  it('devolve 401 quando a verificacao falha', async () => {
    mockVerify.mockImplementation(() => {
      throw new Error('invalid signature');
    });

    const res = await request(makeApp()).get('/protegido').set('Authorization', 'Bearer tok');

    expect(res.status).toBe(401);
    // Detalhe interno da biblioteca nao sai na resposta.
    expect(res.body.error).toBe('Token inválido ou expirado');
  });

  it('devolve 401 para conta desativada mesmo com token valido', async () => {
    mockVerify.mockReturnValue({ id: 1, email: 'a@grupounico.com', role: 'admin' });
    queryQueue.push(
      createResolvedChain([{ id: 1, email: 'a@grupounico.com', role: 'admin', isActive: false }]),
    );

    const res = await request(makeApp()).get('/protegido').set('Authorization', 'Bearer tok');

    expect(res.status).toBe(401);
  });

  it('bloqueia analista em rota administrativa', async () => {
    mockVerify.mockReturnValue({ id: 2, email: 'b@grupounico.com', role: 'analyst' });
    queryQueue.push(
      createResolvedChain([{ id: 2, email: 'b@grupounico.com', role: 'analyst', isActive: true }]),
    );

    const res = await request(makeApp()).get('/admin').set('Authorization', 'Bearer tok');

    expect(res.status).toBe(403);
  });
});
