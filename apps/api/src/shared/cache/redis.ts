import { logger } from '../utils/logger.js';

// ── In-memory cache (fallback when Redis is unavailable) ─────────────

class MemoryCache {
  private store = new Map<string, { value: string; expiresAt: number }>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Periodically clean expired entries
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  /**
   * Incremento ATOMICO com janela fixa. Devolve o contador e quando a janela
   * expira. O Node e single-threaded, entao ler e escrever aqui dentro do mesmo
   * tick e atomico de fato — nao ha ponto de suspensao entre os dois.
   */
  async incr(key: string, ttlSeconds: number): Promise<{ count: number; resetAt: number }> {
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || now > entry.expiresAt) {
      const expiresAt = now + ttlSeconds * 1000;
      this.store.set(key, { value: '1', expiresAt });
      return { count: 1, resetAt: expiresAt };
    }

    const count = Number(entry.value) + 1;
    this.store.set(key, { value: String(count), expiresAt: entry.expiresAt });
    return { count, resetAt: entry.expiresAt };
  }

  async disconnect(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.store.clear();
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }
}

// ── Cache interface ──────────────────────────────────────────────────

export interface CacheClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  /**
   * Incremento atomico com janela fixa, para contadores de rate limit.
   *
   * O limitador fazia `get` -> `JSON.parse` -> `set`, sem nada de atomico entre
   * a leitura e a escrita: uma rajada concorrente lia o MESMO contador e
   * escrevia o mesmo valor, entao o limite de 5 tentativas por janela do login
   * podia ser ultrapassado com folga por requisicoes paralelas.
   */
  incr(key: string, ttlSeconds: number): Promise<{ count: number; resetAt: number }>;
  disconnect(): Promise<void>;
}

// ── Redis-backed cache ───────────────────────────────────────────────

/**
 * Aviso de degradacao do limitador, com janela de silencio.
 *
 * Sem a janela, uma queda do Redis viraria uma linha de log por requisicao —
 * o mesmo problema de spam que levou ao circuit breaker do Google Chat. Com
 * ela, o operador ve a degradacao comecar e ve que ela persiste, sem afogar o
 * log.
 *
 * So o BUCKET vai para o log, nunca o identificador: a chave termina com o id
 * do usuario ou o IP do cliente, e nada disso precisa estar no log para
 * diagnosticar que o Redis caiu.
 */
const INTERVALO_AVISO_DEGRADACAO_MS = 60_000;
let ultimoAvisoDegradacao = 0;

export function bucketDaChave(key: string): string {
  const semPrefixo = key.startsWith('rl:') ? key.slice(3) : key;
  const ultimoSeparador = semPrefixo.lastIndexOf(':');
  return ultimoSeparador > 0 ? semPrefixo.slice(0, ultimoSeparador) : semPrefixo;
}

function avisarDegradacaoDoLimitador(key: string, err: unknown): void {
  const agora = Date.now();
  if (agora - ultimoAvisoDegradacao < INTERVALO_AVISO_DEGRADACAO_MS) return;
  ultimoAvisoDegradacao = agora;
  logger.warn(
    { err, bucket: bucketDaChave(key) },
    'Contador de rate limit caiu para memoria: a contagem RECOMECA e a protecao fica enfraquecida',
  );
}

/** Reseta a janela de silencio. Existe para o teste. */
export function resetarAvisoDegradacao(): void {
  ultimoAvisoDegradacao = 0;
}

class RedisCache implements CacheClient {
  private client: import('ioredis').default | null = null;
  private fallback = new MemoryCache();
  private connected = false;

  async init(): Promise<void> {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      logger.info('REDIS_URL not set, using in-memory cache');
      return;
    }

    try {
      const { default: Redis } = await import('ioredis');
      this.client = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        retryStrategy: (times) => {
          if (times > 5) return null; // stop retrying
          return Math.min(times * 200, 2000);
        },
      });

      this.client.on('error', (err) => {
        if (this.connected) {
          logger.warn({ err: err.message }, 'Redis connection error, falling back to memory cache');
          this.connected = false;
        }
      });

      this.client.on('connect', () => {
        this.connected = true;
        logger.info('Redis connected');
      });

      await this.client.connect();
    } catch (err) {
      logger.warn({ err }, 'Failed to connect to Redis, using in-memory cache');
      this.client = null;
    }
  }

  async get(key: string): Promise<string | null> {
    if (this.connected && this.client) {
      try {
        return await this.client.get(key);
      } catch {
        return this.fallback.get(key);
      }
    }
    return this.fallback.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (this.connected && this.client) {
      try {
        await this.client.set(key, value, 'EX', ttlSeconds);
        return;
      } catch {
        // fall through to memory
      }
    }
    await this.fallback.set(key, value, ttlSeconds);
  }

  async del(key: string): Promise<void> {
    if (this.connected && this.client) {
      try {
        await this.client.del(key);
        return;
      } catch {
        // fall through
      }
    }
    await this.fallback.del(key);
  }

  async incr(key: string, ttlSeconds: number): Promise<{ count: number; resetAt: number }> {
    if (this.connected && this.client) {
      try {
        // INCR e atomico no servidor: duas requisicoes concorrentes recebem
        // valores diferentes, que e exatamente o que o limitador precisa.
        const count = await this.client.incr(key);
        // A janela e fixa: so o primeiro incremento define o TTL, entao a
        // janela nao "anda para a frente" a cada tentativa.
        if (count === 1) {
          await this.client.expire(key, ttlSeconds);
          return { count, resetAt: Date.now() + ttlSeconds * 1000 };
        }
        const ttl = await this.client.ttl(key);
        // TTL -1 significa chave sem expiracao — so acontece se o processo
        // morreu entre o INCR e o EXPIRE. Reaplica em vez de deixar o contador
        // eterno, que travaria o usuario para sempre.
        if (ttl < 0) {
          await this.client.expire(key, ttlSeconds);
          return { count, resetAt: Date.now() + ttlSeconds * 1000 };
        }
        return { count, resetAt: Date.now() + ttl * 1000 };
      } catch (err) {
        // Este catch era nu. O `incr` cair para memoria significa que o
        // contador do limitador RECOMECA DO 1 — num limitador de login, e a
        // protecao contra forca bruta desaparecendo. Nao pode acontecer em
        // silencio.
        //
        // O `logger.warn` que existia para isso mora no catch do middleware
        // (`shared/middleware/rate-limit.ts`) e e INALCANCAVEL: este catch
        // engole tudo, e `MemoryCache.incr` e sincrono e nao lanca. Ou seja,
        // havia dois fallbacks e o que efetivamente roda era justamente o que
        // nao avisava ninguem.
        avisarDegradacaoDoLimitador(key, err);
        // fall through to memory
      }
    }
    return this.fallback.incr(key, ttlSeconds);
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.connected = false;
    }
    await this.fallback.disconnect();
  }
}

// ── Singleton ────────────────────────────────────────────────────────

export const cache: CacheClient = new RedisCache();

export async function initCache(): Promise<void> {
  await (cache as RedisCache).init();
}

export async function stopCache(): Promise<void> {
  await cache.disconnect();
}
