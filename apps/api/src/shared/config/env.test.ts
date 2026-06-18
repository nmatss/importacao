import { afterEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

function setEnv(overrides: Record<string, string | undefined> = {}) {
  process.env = {
    ...originalEnv,
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/importacao',
    JWT_SECRET: '1234567890123456',
    ...overrides,
  };
}

async function loadEnv(overrides: Record<string, string | undefined> = {}) {
  vi.resetModules();
  setEnv(overrides);
  const mod = await import('./env.js');
  return mod.getEnv();
}

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe('env IA policy', () => {
  it('usa IA_LOCAL como provider default', async () => {
    const env = await loadEnv({ IA_LOCAL_API_KEY: 'test-token' });

    expect(env.AI_PROVIDER).toBe('ialocal');
    expect(env.AI_ALLOW_EXTERNAL).toBe('false');
    expect(env.IA_LOCAL_BASE_URL).toBe('http://ia-local-gateway:8443/v1');
  });

  it('exige token do gateway quando provider e IA_LOCAL', async () => {
    await expect(loadEnv()).rejects.toThrow(/IA_LOCAL_API_KEY/);
  });

  it('bloqueia provider externo sem AI_ALLOW_EXTERNAL=true', async () => {
    await expect(
      loadEnv({
        AI_PROVIDER: 'openrouter',
        OPENROUTER_API_KEY: 'test-key',
      }),
    ).rejects.toThrow(/AI_ALLOW_EXTERNAL=true/);
  });

  it('aceita provider externo somente com flag explicita', async () => {
    const env = await loadEnv({
      AI_PROVIDER: 'openrouter',
      AI_ALLOW_EXTERNAL: 'true',
      OPENROUTER_API_KEY: 'test-key',
    });

    expect(env.AI_PROVIDER).toBe('openrouter');
    expect(env.AI_ALLOW_EXTERNAL).toBe('true');
  });

  it('nao exige destinatarios operacionais no env de producao', async () => {
    const env = await loadEnv({
      NODE_ENV: 'production',
      GOOGLE_CLIENT_ID: 'google-client-id',
      IA_LOCAL_API_KEY: 'test-token',
      KIOM_EMAIL: undefined,
      FENICIA_EMAIL: undefined,
      ISA_EMAIL: undefined,
    });

    expect(env.NODE_ENV).toBe('production');
    expect(env.GOOGLE_CLIENT_ID).toBe('google-client-id');
  });

  it('valida lista opcional de destinatarios operacionais no env', async () => {
    const env = await loadEnv({
      IA_LOCAL_API_KEY: 'test-token',
      KIOM_EMAIL: 'contact@kiomglobal.com;ops@kiomglobal.com',
    });

    expect(env.KIOM_EMAIL).toBe('contact@kiomglobal.com;ops@kiomglobal.com');
    await expect(
      loadEnv({
        IA_LOCAL_API_KEY: 'test-token',
        KIOM_EMAIL: 'contact@kiomglobal.com,nao-e-email',
      }),
    ).rejects.toThrow(/KIOM_EMAIL/);
  });
});
