import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { OpenRouterProvider } from '../openrouter.js';

describe('OpenRouterProvider', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.OPENROUTER_BASE_URL = 'https://openrouter.test/api/v1';
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('normalizeModel adds google/ prefix when missing', () => {
    const p = new OpenRouterProvider();
    expect(p.normalizeModel('gemini-2.5-flash')).toBe('google/gemini-2.5-flash');
    expect(p.normalizeModel('google/gemini-2.5-flash')).toBe('google/gemini-2.5-flash');
    expect(p.normalizeModel('anthropic/claude-sonnet')).toBe('anthropic/claude-sonnet');
  });

  it('builds a json_object response_format by default', async () => {
    let capturedBody: any;
    globalThis.fetch = vi.fn(async (_url, init) => {
      capturedBody = JSON.parse((init as any).body);
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{}' } }],
          usage: { prompt_tokens: 5, completion_tokens: 2 },
        }),
        { status: 200 },
      );
    }) as any;

    const p = new OpenRouterProvider();
    const res = await p.callModel('gemini-2.5-flash', [{ role: 'user', content: 'hi' }], {});
    expect(capturedBody.response_format).toEqual({ type: 'json_object' });
    expect(capturedBody.model).toBe('google/gemini-2.5-flash');
    expect(capturedBody.temperature).toBe(0);
    expect(res.usage).toEqual({ inputTokens: 5, outputTokens: 2 });
  });

  it('builds a json_schema response_format when responseSchema is set', async () => {
    let capturedBody: any;
    globalThis.fetch = vi.fn(async (_url, init) => {
      capturedBody = JSON.parse((init as any).body);
      return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), {
        status: 200,
      });
    }) as any;

    const schema = { type: 'object', properties: { x: { type: 'number' } } };
    const p = new OpenRouterProvider();
    await p.callModel('gemini-2.5-flash', [{ role: 'user', content: 'hi' }], {
      responseSchema: schema,
    });
    expect(capturedBody.response_format.type).toBe('json_schema');
    expect(capturedBody.response_format.json_schema.schema).toEqual(schema);
  });

  it('throws when the API returns an error status', async () => {
    globalThis.fetch = vi.fn(async () => new Response('rate limited', { status: 429 })) as any;
    const p = new OpenRouterProvider();
    await expect(
      p.callModel('gemini-2.5-flash', [{ role: 'user', content: 'hi' }], {}),
    ).rejects.toThrow(/429/);
  });

  it('throws when content is empty', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), { status: 200 }),
    ) as any;
    const p = new OpenRouterProvider();
    await expect(
      p.callModel('gemini-2.5-flash', [{ role: 'user', content: 'hi' }], {}),
    ).rejects.toThrow(/Empty response/);
  });
});
