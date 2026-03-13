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
  disconnect(): Promise<void>;
}

// ── Redis-backed cache ───────────────────────────────────────────────

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
