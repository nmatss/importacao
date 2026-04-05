import { logger } from './logger.js';

// ── withRetry ────────────────────────────────────────────────────────────────

export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs?: number;
}

/**
 * Retry a function with exponential backoff and jitter.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
  label?: string,
): Promise<T> {
  const { attempts, baseDelayMs, maxDelayMs = 30_000 } = opts;
  let lastError: Error | unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === attempts) break;

      // Exponential backoff with full jitter
      const expDelay = baseDelayMs * 2 ** (attempt - 1);
      const jitter = Math.random() * expDelay;
      const delay = Math.min(expDelay + jitter, maxDelayMs);

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
 */
export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label?: string,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);

  try {
    const result = await fn(controller.signal);
    clearTimeout(timer);
    return result;
  } catch (err) {
    clearTimeout(timer);
    if (controller.signal.aborted) {
      const timeoutErr = new Error(`Operation timed out after ${ms}ms${label ? ` [${label}]` : ''}`);
      (timeoutErr as any).code = 'ETIMEDOUT';
      throw timeoutErr;
    }
    throw err;
  }
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
        { label, failureCount: this.failureCount, resetAt: new Date(this.nextAttemptAt).toISOString() },
        'CircuitBreaker opened',
      );
    }
  }
}
