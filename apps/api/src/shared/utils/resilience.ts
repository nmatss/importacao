import { logger } from './logger.js';

// ── withRetry ────────────────────────────────────────────────────────────────

export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  /**
   * Optional predicate to decide whether a given error is worth retrying.
   * When provided and it returns `false`, withRetry rethrows immediately
   * instead of consuming the remaining attempts (and budget/cost). When
   * omitted, every error is retried — preserving the original behaviour for
   * all existing callers that don't pass it.
   */
  shouldRetry?: (err: unknown) => boolean;
  /**
   * Optional per-error delay override. When it returns a number, that value
   * replaces the exponential backoff for the next attempt — this is how a
   * `Retry-After` header sent by the provider gets respected instead of being
   * ignored in favour of our own guess. Still clamped by `maxDelayMs`, so a
   * hostile or absurd header cannot park the sweep for an hour.
   */
  retryDelayMs?: (err: unknown) => number | null;
}

/**
 * Retry a function with exponential backoff and jitter.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
  label?: string,
): Promise<T> {
  const { attempts, baseDelayMs, maxDelayMs = 30_000, shouldRetry, retryDelayMs } = opts;
  let lastError: Error | unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      // Non-retryable error (e.g. 4xx / budget exhausted): don't waste the
      // remaining attempts. Rethrow now. Only applies when a predicate is
      // supplied — default callers keep retrying everything.
      if (shouldRetry && !shouldRetry(err)) throw err;
      if (attempt === attempts) break;

      // Exponential backoff with full jitter, unless the provider told us how
      // long to wait (Retry-After); then obey it instead of guessing.
      const explicitDelay = retryDelayMs?.(err) ?? null;
      const expDelay = baseDelayMs * 2 ** (attempt - 1);
      const jitter = Math.random() * expDelay;
      const delay =
        explicitDelay !== null && explicitDelay >= 0
          ? Math.min(explicitDelay, maxDelayMs)
          : Math.min(expDelay + jitter, maxDelayMs);

      logger.warn(
        { attempt, maxAttempts: attempts, delayMs: Math.round(delay), label, err },
        'Retry attempt failed, backing off',
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

// ── withTimeout ──────────────────────────────────────────────────────────────

/**
 * Wrap a function call with an AbortController-based timeout.
 *
 * Faz as DUAS coisas, e as duas importam:
 *
 * 1. aborta o `signal`, para o cliente de verdade cancelar a requisicao em voo
 *    em vez de continuar esperando resposta que ninguem vai ler;
 * 2. rejeita o chamador no prazo de qualquer jeito.
 *
 * O item 2 nao e redundante. Se o callee ignorar o `signal` — cliente antigo,
 * mock, biblioteca que so aceita o sinal de fachada — o `await fn(...)` nunca
 * volta, e apenas abortar deixaria o chamador pendurado para sempre. Era essa
 * a unica garantia do `Promise.race` que este helper substituiu; ela continua
 * valendo, agora somada ao cancelamento real.
 */
export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label?: string,
): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;

  const timeoutError = () => {
    const err = new Error(`Operation timed out after ${ms}ms${label ? ` [${label}]` : ''}`);
    (err as any).code = 'ETIMEDOUT';
    return err;
  };

  try {
    return await new Promise<T>((resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(timeoutError());
      }, ms);
      fn(controller.signal).then(resolve, reject);
    });
  } catch (err) {
    // O abort chegou ao cliente e ele rejeitou com AbortError: quem pediu
    // precisa ler "estourou o tempo", nao "operacao abortada".
    if (controller.signal.aborted) throw timeoutError();
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── isNetworkError ──────────────────────────────────────────────────────────

const NETWORK_ERROR_CODES = new Set([
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/**
 * Distingue "o outro lado respondeu que nao" de "nao consegui falar com o outro
 * lado". Sem isso, uma queda de rede vira erro de autorizacao — foi o que
 * derrubou o login Google em agosto/2026: ETIMEDOUT virava 401 e o operador
 * lia "sessao expirou".
 *
 * Cobre tambem o Gaxios/Axios, que embrulha o erro de socket em `err.error` e
 * so preenche `err.response` quando houve resposta HTTP de verdade.
 */
export function isNetworkError(err: unknown, depth = 0): boolean {
  if (!err || typeof err !== 'object' || depth > 5) return false;
  const e = err as {
    code?: unknown;
    cause?: unknown;
    error?: unknown;
    response?: unknown;
    name?: unknown;
  };

  if (e.response) return false; // houve resposta HTTP: e erro de aplicacao, nao de rede
  if (e.name === 'AbortError' || e.name === 'TimeoutError') return true;
  if (typeof e.code === 'string' && NETWORK_ERROR_CODES.has(e.code)) return true;

  return isNetworkError(e.cause, depth + 1) || isNetworkError(e.error, depth + 1);
}

// ── CircuitBreaker ──────────────────────────────────────────────────────────

type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit */
  failureThreshold: number;
  /** Milliseconds to wait before attempting to close an open circuit */
  resetAfterMs: number;
  /** Number of successful calls in half-open state to close the circuit */
  successThreshold?: number;
}

export class CircuitBreaker<T = unknown> {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private nextAttemptAt: number | null = null;
  private readonly failureThreshold: number;
  private readonly resetAfterMs: number;
  private readonly successThreshold: number;

  constructor(opts: CircuitBreakerOptions) {
    this.failureThreshold = opts.failureThreshold;
    this.resetAfterMs = opts.resetAfterMs;
    this.successThreshold = opts.successThreshold ?? 1;
  }

  get currentState(): CircuitState {
    return this.state;
  }

  async call(fn: () => Promise<T>, label?: string): Promise<T> {
    if (this.state === 'open') {
      if (this.nextAttemptAt !== null && Date.now() >= this.nextAttemptAt) {
        this.state = 'half-open';
        this.successCount = 0;
        logger.info({ label }, 'CircuitBreaker transitioning to half-open');
      } else {
        throw new Error(
          `CircuitBreaker is open${label ? ` [${label}]` : ''}. Retry after ${this.nextAttemptAt ? new Date(this.nextAttemptAt).toISOString() : 'unknown'}.`,
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess(label);
      return result;
    } catch (err) {
      this.onFailure(label);
      throw err;
    }
  }

  private onSuccess(label?: string): void {
    this.failureCount = 0;
    if (this.state === 'half-open') {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.state = 'closed';
        this.nextAttemptAt = null;
        logger.info({ label }, 'CircuitBreaker closed after successful half-open probe');
      }
    }
  }

  private onFailure(label?: string): void {
    this.failureCount++;
    if (this.state === 'half-open' || this.failureCount >= this.failureThreshold) {
      this.state = 'open';
      this.nextAttemptAt = Date.now() + this.resetAfterMs;
      logger.warn(
        {
          label,
          failureCount: this.failureCount,
          resetAt: new Date(this.nextAttemptAt).toISOString(),
        },
        'CircuitBreaker opened',
      );
    }
  }
}
