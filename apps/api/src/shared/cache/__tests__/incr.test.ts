import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { cache } from '../redis.js';

/**
 * `cache.incr` e a primitiva que sustenta o rate limit. Sem Redis configurado
 * — que e o caso em desenvolvimento e em teste — quem responde e o MemoryCache,
 * entao esta implementacao NAO e um detalhe de fallback: e a que roda na maior
 * parte do tempo fora de producao.
 */
describe('cache.incr', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(async () => {
    await cache.del('t:incr');
    await cache.del('t:janela');
  });

  it('devolve contadores SEQUENCIAIS, mesmo com chamadas concorrentes', async () => {
    // Este e o ponto todo. O padrao antigo (`get` -> parse -> `set`) fazia
    // chamadas concorrentes lerem o mesmo valor e escreverem o mesmo valor.
    const resultados = await Promise.all(
      Array.from({ length: 20 }, () => cache.incr('t:incr', 60)),
    );

    const contadores = resultados.map((r) => r.count).sort((a, b) => a - b);
    expect(contadores).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(new Set(contadores).size).toBe(20);
  });

  it('a janela e FIXA: incrementos seguintes nao empurram o vencimento', async () => {
    const primeiro = await cache.incr('t:janela', 60);
    await new Promise((resolve) => setTimeout(resolve, 15));
    const segundo = await cache.incr('t:janela', 60);

    expect(segundo.count).toBe(2);
    // Se o TTL fosse renovado a cada tentativa, `resetAt` teria andado para a
    // frente e a janela nunca fecharia.
    expect(segundo.resetAt).toBe(primeiro.resetAt);
  });

  it('recomeca do 1 depois que a janela expira', async () => {
    const primeiro = await cache.incr('t:janela', 1);
    expect(primeiro.count).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 1100));

    const depois = await cache.incr('t:janela', 1);
    expect(depois.count).toBe(1);
    expect(depois.resetAt).toBeGreaterThan(primeiro.resetAt);
  });

  it('chaves diferentes nao compartilham contador', async () => {
    await cache.incr('t:incr', 60);
    await cache.incr('t:incr', 60);
    const outra = await cache.incr('t:janela', 60);

    expect(outra.count).toBe(1);
  });
});
