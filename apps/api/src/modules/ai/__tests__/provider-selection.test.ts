import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../shared/database/connection.js', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(async (fn: any) => fn({})),
  },
}));

vi.mock('../../alerts/service.js', () => ({
  alertService: { create: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../cost-tracker.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    assertBudgetAvailable: vi.fn().mockResolvedValue(undefined),
    logUsage: vi.fn().mockResolvedValue(undefined),
    getMonthlySpendUSD: vi.fn().mockResolvedValue(0),
    getUsageSummary: vi.fn().mockResolvedValue({
      monthlySpendUSD: 0,
      budgetUSD: 200,
      budgetPctUsed: 0,
      byModel: [],
    }),
  };
});

vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const ENV_KEYS = [
  'AI_PROVIDER',
  'AI_ALLOW_EXTERNAL',
  'IA_LOCAL_BASE_URL',
  'IA_LOCAL_API_KEY',
  'IA_LOCAL_MODEL',
  'IA_LOCAL_ALLOWED_HOSTS',
] as const;

const originalEnv = new Map<string, string | undefined>();

function configureLocalEnv(): void {
  process.env.IA_LOCAL_BASE_URL = 'http://ia-local-gateway:8443/v1';
  process.env.IA_LOCAL_API_KEY = 'test-token';
  process.env.IA_LOCAL_MODEL = 'unico-docintel';
  process.env.IA_LOCAL_ALLOWED_HOSTS = 'ia-local-gateway,localhost';
}

describe('AI provider selection', () => {
  beforeEach(() => {
    vi.resetModules();
    for (const key of ENV_KEYS) {
      originalEnv.set(key, process.env[key]);
      delete process.env[key];
    }
    configureLocalEnv();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of ENV_KEYS) {
      const value = originalEnv.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    originalEnv.clear();
  });

  it('defaults to IA_LOCAL when AI_PROVIDER is unset', async () => {
    const mod = await import('../service.js');

    expect((mod.aiService as any).provider.name).toBe('ialocal');
  });

  it('blocks OpenRouter unless AI_ALLOW_EXTERNAL is explicitly true', async () => {
    process.env.AI_PROVIDER = 'openrouter';
    process.env.AI_ALLOW_EXTERNAL = 'false';

    await expect(import('../service.js')).rejects.toThrow(
      'AI provider openrouter is external and requires AI_ALLOW_EXTERNAL=true',
    );
  });

  it('blocks Vertex unless AI_ALLOW_EXTERNAL is explicitly true', async () => {
    process.env.AI_PROVIDER = 'vertex';
    process.env.AI_ALLOW_EXTERNAL = 'false';

    await expect(import('../service.js')).rejects.toThrow(
      'AI provider vertex is external and requires AI_ALLOW_EXTERNAL=true',
    );
  });

  it('allows OpenRouter only after explicit external-provider opt-in', async () => {
    process.env.AI_PROVIDER = 'openrouter';
    process.env.AI_ALLOW_EXTERNAL = 'true';

    const mod = await import('../service.js');

    expect((mod.aiService as any).provider.name).toBe('openrouter');
  });

  it('uses deterministic local anomaly analysis without external calls', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const mod = await import('../service.js');

    const result = await mod.aiService.detectAnomalies({ invoiceNumber: 'INV-001' }, {}, {});

    expect(result).toEqual({ anomalies: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects invalid anomaly detection response contracts', async () => {
    process.env.AI_PROVIDER = 'openrouter';
    process.env.AI_ALLOW_EXTERNAL = 'true';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ unexpected: [] }) } }],
          usage: { prompt_tokens: 10, completion_tokens: 3 },
        }),
        text: async () => '',
      }),
    );

    const mod = await import('../service.js');

    await expect(mod.aiService.detectAnomalies({}, {}, {})).rejects.toThrow(
      'AI response for anomaly detection failed contract validation',
    );
  });
});
