import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IALocalProvider } from '../ialocal.js';

const ENV_KEYS = [
  'IA_LOCAL_BASE_URL',
  'IA_LOCAL_API_KEY',
  'IA_LOCAL_MODEL',
  'IA_LOCAL_ALLOWED_HOSTS',
  'IA_LOCAL_NUM_PREDICT',
  'IA_LOCAL_NUM_CTX',
] as const;

const originalEnv = new Map<string, string | undefined>();

describe('IALocalProvider', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originalEnv.set(key, process.env[key]);
      delete process.env[key];
    }
    process.env.IA_LOCAL_BASE_URL = 'http://ia-local-gateway:8443/v1';
    process.env.IA_LOCAL_API_KEY = 'test-token';
    process.env.IA_LOCAL_MODEL = 'unico-docintel';
    process.env.IA_LOCAL_ALLOWED_HOSTS = 'ia-local-gateway,localhost';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of ENV_KEYS) {
      const value = originalEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    originalEnv.clear();
  });

  it('collapses requested model aliases to unico-docintel with bounded local generation', async () => {
    process.env.IA_LOCAL_NUM_PREDICT = '777';
    process.env.IA_LOCAL_NUM_CTX = '4096';
    let capturedBody: any;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url, init) => {
        capturedBody = JSON.parse(init.body as string);
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: '{"ok":true}' } }],
            usage: { prompt_tokens: 3, completion_tokens: 2 },
          }),
          text: async () => '',
        };
      }),
    );

    const provider = new IALocalProvider();
    const result = await provider.callModel(
      'gemini-2.5-flash',
      [{ role: 'user', content: 'retorne json' }],
      { jsonMode: true },
    );

    expect(result.content).toBe('{"ok":true}');
    expect(capturedBody.model).toBe('unico-docintel');
    expect(capturedBody.stream).toBe(false);
    expect(capturedBody.response_format).toEqual({ type: 'json_object' });
    expect(capturedBody.options).toMatchObject({ temperature: 0, num_predict: 777, num_ctx: 4096 });
  });

  it('blocks non-allowlisted IA_LOCAL hosts', () => {
    process.env.IA_LOCAL_BASE_URL = 'https://api.external.example/v1';

    expect(() => new IALocalProvider()).toThrow('IA_LOCAL_BASE_URL bloqueado');
  });
});
