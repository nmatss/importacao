import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const cacheMocks = vi.hoisted(() => ({ incr: vi.fn() }));

vi.mock('../../cache/redis.js', () => ({ cache: cacheMocks }));
vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createRateLimiter } from '../rate-limit.js';

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    ip: '203.0.113.10',
    path: '/login',
    baseUrl: '/api/auth',
    ...overrides,
  } as unknown as Request;
}

function makeRes() {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    set(name: string, value: string) {
      headers[name] = value;
      return res;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return { res: res as unknown as Response, headers, ref: res };
}

describe('createRateLimiter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('usa incremento ATOMICO do cache, nao get-modifica-set', async () => {
    // O defeito original: `cache.get` -> `JSON.parse` -> `cache.set`. Entre a
    // leitura e a escrita nao havia nada de atomico, entao requisicoes
    // concorrentes liam o MESMO contador e escreviam o mesmo valor — o limite
    // de 5 tentativas por janela do login era ultrapassado por uma rajada
    // paralela. Esta asercao e o que impede a volta do padrao.
    cacheMocks.incr.mockResolvedValue({ count: 1, resetAt: Date.now() + 60_000 });
    const limiter = createRateLimiter(5, 60_000);
    const next = vi.fn() as unknown as NextFunction;
    const { res } = makeRes();

    await limiter(makeReq(), res, next);

    expect(cacheMocks.incr).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('uma rajada concorrente NAO passa do limite', async () => {
    // Contador real e sequencial, como o INCR do Redis devolveria.
    let counter = 0;
    const resetAt = Date.now() + 60_000;
    cacheMocks.incr.mockImplementation(async () => ({ count: ++counter, resetAt }));

    const limiter = createRateLimiter(5, 60_000);
    const resultados = await Promise.all(
      Array.from({ length: 12 }, async () => {
        const next = vi.fn() as unknown as NextFunction;
        const { res, ref } = makeRes();
        await limiter(makeReq(), res, next);
        return {
          passou: (next as unknown as ReturnType<typeof vi.fn>).mock.calls.length > 0,
          status: ref.statusCode,
        };
      }),
    );

    const passaram = resultados.filter((r) => r.passou).length;
    const bloqueados = resultados.filter((r) => !r.passou).length;

    expect(passaram).toBe(5);
    expect(bloqueados).toBe(7);
    expect(resultados.filter((r) => !r.passou).every((r) => r.status === 429)).toBe(true);
  });

  it('a janela e FIXA: o TTL so e definido no primeiro incremento', async () => {
    // Se cada tentativa renovasse o TTL, um atacante persistente manteria a
    // janela aberta para sempre e nunca seria destravado — nem travado.
    const resetAt = Date.now() + 60_000;
    cacheMocks.incr.mockResolvedValue({ count: 3, resetAt });
    const limiter = createRateLimiter(5, 60_000);
    const { res, headers } = makeRes();

    await limiter(makeReq(), res, vi.fn() as unknown as NextFunction);

    expect(cacheMocks.incr).toHaveBeenCalledWith(expect.any(String), 60);
    expect(headers['X-RateLimit-Reset']).toBe(Math.ceil(resetAt / 1000).toString());
  });

  it('a chave inclui o caminho COMPLETO, nao o path relativo do Router', async () => {
    // `req.path` dentro de um Router montado e relativo: duas rotas homonimas
    // em modulos diferentes compartilhariam o mesmo balde.
    cacheMocks.incr.mockResolvedValue({ count: 1, resetAt: Date.now() + 60_000 });
    const limiter = createRateLimiter(5, 60_000);

    await limiter(
      makeReq({ baseUrl: '/api/auth', path: '/login' }),
      makeRes().res,
      vi.fn() as unknown as NextFunction,
    );
    await limiter(
      makeReq({ baseUrl: '/api/sydle', path: '/login' }),
      makeRes().res,
      vi.fn() as unknown as NextFunction,
    );

    const [primeira] = cacheMocks.incr.mock.calls[0];
    const [segunda] = cacheMocks.incr.mock.calls[1];
    expect(primeira).toContain('/api/auth/login');
    expect(segunda).toContain('/api/sydle/login');
    expect(primeira).not.toBe(segunda);
  });

  it('separa o balde por identidade', async () => {
    cacheMocks.incr.mockResolvedValue({ count: 1, resetAt: Date.now() + 60_000 });
    const limiter = createRateLimiter(5, 60_000);

    await limiter(
      makeReq({ ip: '203.0.113.10' }),
      makeRes().res,
      vi.fn() as unknown as NextFunction,
    );
    await limiter(
      makeReq({ ip: '203.0.113.99' }),
      makeRes().res,
      vi.fn() as unknown as NextFunction,
    );

    expect(cacheMocks.incr.mock.calls[0][0]).not.toBe(cacheMocks.incr.mock.calls[1][0]);
  });

  it('cai para o contador em memoria quando o cache falha, sem liberar a rota', async () => {
    cacheMocks.incr.mockRejectedValue(new Error('redis down'));
    const limiter = createRateLimiter(2, 60_000);

    const chamadas = [];
    for (let i = 0; i < 4; i += 1) {
      const next = vi.fn() as unknown as NextFunction;
      const { res, ref } = makeRes();
      await limiter(makeReq({ ip: '198.51.100.7' }), res, next);
      chamadas.push({
        passou: (next as unknown as ReturnType<typeof vi.fn>).mock.calls.length > 0,
        status: ref.statusCode,
      });
    }

    expect(chamadas.filter((c) => c.passou).length).toBe(2);
    expect(chamadas.filter((c) => !c.passou).every((c) => c.status === 429)).toBe(true);
  });
});
