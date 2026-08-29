import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('../../utils/logger.js', () => ({ logger }));

/** Cliente falso cujo `incr` sempre falha, como um Redis com chave envenenada. */
class RedisQueFalha extends EventEmitter {
  async connect() {
    this.emit('connect');
  }
  async incr(): Promise<never> {
    throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
  }
  async expire() {
    return 1;
  }
  async ttl() {
    return 60;
  }
  async quit() {
    return 'OK';
  }
}
vi.mock('ioredis', () => ({ default: RedisQueFalha }));

const { cache, initCache, bucketDaChave, resetarAvisoDegradacao } = await import('../redis.js');

/**
 * Quando `cache.incr` cai para memoria, o contador do limitador RECOMECA DO 1.
 * Num limitador de login isso e a protecao contra forca bruta desaparecendo.
 *
 * Ate 2026-08-29 o `catch` que fazia essa queda era NU. O `logger.warn` escrito
 * para avisar mora no catch do middleware e e inalcancavel — o catch do
 * `RedisCache.incr` engole tudo, e `MemoryCache.incr` e sincrono e nao lanca.
 * Havia dois fallbacks e o que efetivamente rodava era o que nao avisava.
 */
describe('degradacao do rate limiter para memoria', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    resetarAvisoDegradacao();
    process.env.REDIS_URL = 'redis://fake:6379';
    await initCache();
  });

  it('avisa quando o contador cai para memoria', async () => {
    const r = await cache.incr('rl:/api/auth/login:200.1.2.3', 900);

    // Caiu para memoria: contagem recomecou.
    expect(r.count).toBe(1);

    const avisos = logger.warn.mock.calls.filter((c) => String(c[1]).match(/rate limit|memoria/i));
    expect(avisos.length).toBe(1);
    expect(String(avisos[0][1])).toMatch(/RECOMECA/);
  });

  it('NAO coloca o identificador do cliente no log — so o bucket', async () => {
    await cache.incr('rl:/api/auth/login:200.1.2.3', 900);

    const aviso = logger.warn.mock.calls.find((c) => String(c[1]).match(/rate limit|memoria/i));
    const contexto = JSON.stringify(aviso?.[0] ?? {});

    expect(contexto).toContain('/api/auth/login');
    // O IP do cliente (ou o id do usuario) nao precisa estar no log para
    // diagnosticar que o Redis caiu.
    expect(contexto).not.toContain('200.1.2.3');
  });

  it('janela de silencio: uma queda do Redis nao vira uma linha por requisicao', async () => {
    for (let i = 0; i < 25; i += 1) {
      await cache.incr(`rl:/api/auth/login:10.0.0.${i}`, 900);
    }

    const avisos = logger.warn.mock.calls.filter((c) => String(c[1]).match(/rate limit|memoria/i));
    expect(avisos.length).toBe(1);
  });
});

describe('bucketDaChave()', () => {
  it('corta o identificador e preserva a rota', () => {
    expect(bucketDaChave('rl:/api/auth/login:200.1.2.3')).toBe('/api/auth/login');
    expect(bucketDaChave('rl:/api/email-ingestion/history-scan:42')).toBe(
      '/api/email-ingestion/history-scan',
    );
  });
});
