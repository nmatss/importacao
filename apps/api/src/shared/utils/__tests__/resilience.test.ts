import { describe, it, expect, vi } from 'vitest';
import { withRetry, withTimeout, CircuitBreaker, isNetworkError } from '../resilience.js';

describe('isNetworkError', () => {
  it('reconhece o ETIMEDOUT do Gaxios que derrubou o login em 08/2026', () => {
    const gaxiosError = Object.assign(new Error('request to oauth2.googleapis.com failed'), {
      code: 'ETIMEDOUT',
      config: { url: 'https://oauth2.googleapis.com/token' },
      error: { type: 'FetchError', code: 'ETIMEDOUT' },
    });

    expect(isNetworkError(gaxiosError)).toBe(true);
  });

  it('enxerga o codigo aninhado em cause', () => {
    expect(isNetworkError(new Error('fetch failed', { cause: { code: 'ECONNREFUSED' } }))).toBe(
      true,
    );
  });

  it('nao confunde resposta HTTP de erro com falha de rede', () => {
    const httpError = Object.assign(new Error('Forbidden'), {
      code: 'ETIMEDOUT', // codigo enganoso: o que manda e ter havido resposta
      response: { status: 403 },
    });

    expect(isNetworkError(httpError)).toBe(false);
  });

  it('nao trata erro comum como falha de rede', () => {
    expect(isNetworkError(new Error('Wrong recipient'))).toBe(false);
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError('ETIMEDOUT')).toBe(false);
  });

  it('nao entra em loop com cause circular', () => {
    const err: any = new Error('circular');
    err.cause = err;
    expect(isNetworkError(err)).toBe(false);
  });
});

describe('withRetry', () => {
  it('should resolve immediately on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { attempts: 3, baseDelayMs: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure and eventually succeed', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'))
      .mockResolvedValue('success');
    const result = await withRetry(fn, { attempts: 5, baseDelayMs: 1 });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should throw after exhausting all attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));
    await expect(withRetry(fn, { attempts: 3, baseDelayMs: 1 })).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should NOT retry when shouldRetry returns false', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('non-retryable'));
    await expect(
      withRetry(fn, { attempts: 3, baseDelayMs: 1, shouldRetry: () => false }),
    ).rejects.toThrow('non-retryable');
    // Called exactly once — the predicate short-circuited the remaining attempts.
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should keep retrying when shouldRetry returns true', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('fail1')).mockResolvedValue('ok');
    const result = await withRetry(fn, {
      attempts: 3,
      baseDelayMs: 1,
      shouldRetry: () => true,
    });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should pass the error to the shouldRetry predicate', async () => {
    const err = new Error('classify-me');
    const predicate = vi.fn().mockReturnValue(false);
    const fn = vi.fn().mockRejectedValue(err);
    await expect(
      withRetry(fn, { attempts: 3, baseDelayMs: 1, shouldRetry: predicate }),
    ).rejects.toThrow('classify-me');
    expect(predicate).toHaveBeenCalledWith(err);
  });

  it('retries everything by default when shouldRetry is omitted (no behaviour change)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(withRetry(fn, { attempts: 2, baseDelayMs: 1 })).rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('withTimeout', () => {
  it('should resolve if operation completes within timeout', async () => {
    const result = await withTimeout(async (_signal) => 'done', 1000);
    expect(result).toBe('done');
  });

  it('should reject with timeout error if operation exceeds timeout', async () => {
    const slowFn = async (signal: AbortSignal): Promise<string> => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve('slow result'), 500);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('aborted'));
        });
      });
    };
    await expect(withTimeout(slowFn, 50, 'test-op')).rejects.toThrow(
      'Operation timed out after 50ms [test-op]',
    );
  });
});

describe('CircuitBreaker', () => {
  it('should be closed by default and pass through calls', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetAfterMs: 100 });
    const fn = vi.fn().mockResolvedValue('result');
    const result = await cb.call(fn);
    expect(result).toBe('result');
    expect(cb.currentState).toBe('closed');
  });

  it('should open after reaching failure threshold', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, resetAfterMs: 100 });
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    await expect(cb.call(fn)).rejects.toThrow('fail');
    await expect(cb.call(fn)).rejects.toThrow('fail');

    expect(cb.currentState).toBe('open');
    await expect(cb.call(fn)).rejects.toThrow('CircuitBreaker is open');
  });

  it('should transition to half-open after resetAfterMs', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetAfterMs: 50 });
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    await expect(cb.call(fn)).rejects.toThrow('fail');
    expect(cb.currentState).toBe('open');

    await new Promise((r) => setTimeout(r, 60));

    const successFn = vi.fn().mockResolvedValue('recovered');
    const result = await cb.call(successFn);
    expect(result).toBe('recovered');
    expect(cb.currentState).toBe('closed');
  });
});
