import { describe, it, expect, vi } from 'vitest';
import { withRetry, withTimeout, CircuitBreaker } from '../resilience.js';

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
