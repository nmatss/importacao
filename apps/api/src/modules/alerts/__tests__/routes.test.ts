import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `POST /api/alerts` publica no espaco corporativo do Google Chat. Ate
 * 2026-08-29 a rota tinha so `authMiddleware`: qualquer conta autenticada
 * postava mensagem arbitraria no canal, sem limite de taxa.
 */

const authGate = vi.hoisted(() => ({ user: { id: 1, email: 'a@b.c', role: 'admin' } }));

vi.mock('../../../shared/middleware/auth.js', async () => {
  const actual = await vi.importActual<typeof import('../../../shared/middleware/auth.js')>(
    '../../../shared/middleware/auth.js',
  );
  return {
    ...actual,
    // Só a autenticacao e simulada; `adminMiddleware` roda de verdade.
    authMiddleware: (req: any, _res: any, next: any) => {
      req.user = authGate.user;
      next();
    },
  };
});

vi.mock('../../../shared/database/connection.js', () => ({ db: {} }));

const store = vi.hoisted(() => new Map<string, { count: number; resetAt: number }>());
vi.mock('../../../shared/cache/redis.js', () => ({
  cache: {
    // Mesmo contrato do incremento atomico usado pelo rate limiter.
    incr: async (key: string, ttlSeconds: number) => {
      const atual = store.get(key);
      if (!atual || Date.now() > atual.resetAt) {
        const novo = { count: 1, resetAt: Date.now() + ttlSeconds * 1000 };
        store.set(key, novo);
        return novo;
      }
      const novo = { count: atual.count + 1, resetAt: atual.resetAt };
      store.set(key, novo);
      return novo;
    },
    get: async () => null,
    set: async () => undefined,
    del: async (key: string) => {
      store.delete(key);
    },
  },
}));

vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const controller = vi.hoisted(() => ({
  alertController: {
    list: vi.fn((_req: any, res: any) => res.json({ success: true, data: [] })),
    create: vi.fn((_req: any, res: any) =>
      res.status(201).json({ success: true, data: { id: 1 } }),
    ),
    acknowledge: vi.fn((_req: any, res: any) => res.json({ success: true })),
  },
}));
vi.mock('../controller.js', () => controller);

const { alertRoutes } = await import('../routes.js');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/alerts', alertRoutes);
  return app;
}

const body = { severity: 'critical', title: 'Titulo', message: 'Mensagem' };

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  authGate.user = { id: 1, email: 'a@b.c', role: 'admin' };
});

describe('POST /api/alerts', () => {
  it('recusa conta autenticada que nao e admin', async () => {
    authGate.user = { id: 2, email: 'u@b.c', role: 'user' };

    const res = await request(makeApp()).post('/api/alerts').send(body);

    expect(res.status).toBe(403);
    expect(controller.alertController.create).not.toHaveBeenCalled();
  });

  it('permite admin', async () => {
    const res = await request(makeApp()).post('/api/alerts').send(body);

    expect(res.status).toBe(201);
    expect(controller.alertController.create).toHaveBeenCalledTimes(1);
  });

  it('limita a taxa mesmo para admin', async () => {
    const app = makeApp();
    let ultimo = 0;
    for (let i = 0; i < 11; i += 1) {
      ultimo = (await request(app).post('/api/alerts').send(body)).status;
    }

    expect(ultimo).toBe(429);
    expect(controller.alertController.create).toHaveBeenCalledTimes(10);
  });
});

describe('GET /api/alerts', () => {
  it('segue aberta a qualquer conta autenticada (so leitura)', async () => {
    authGate.user = { id: 2, email: 'u@b.c', role: 'user' };

    const res = await request(makeApp()).get('/api/alerts');

    expect(res.status).toBe(200);
    expect(controller.alertController.list).toHaveBeenCalled();
  });
});
