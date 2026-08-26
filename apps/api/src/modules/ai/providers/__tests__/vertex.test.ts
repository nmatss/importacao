import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VertexAIProvider } from '../vertex.js';

// Mock google-auth so the provider doesn't try to mint a real token.
vi.mock('@googleapis/drive', () => ({
  auth: {
    GoogleAuth: class {
      constructor(_opts: unknown) {}
      async getAccessToken() {
        return 'fake-token';
      }
    },
  },
}));

describe('VertexAIProvider', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    process.env.GOOGLE_VERTEX_PROJECT = 'test-project';
    process.env.GOOGLE_VERTEX_LOCATION = 'us-central1';
    process.env.GOOGLE_DRIVE_CLIENT_EMAIL = 'sa@test.iam';
    process.env.GOOGLE_DRIVE_PRIVATE_KEY = '-----BEGIN-----\\nfake\\n-----END-----';
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('normalizeModel strips google/ prefix', () => {
    const p = new VertexAIProvider();
    expect(p.normalizeModel('google/gemini-2.5-flash')).toBe('gemini-2.5-flash');
    expect(p.normalizeModel('gemini-2.5-flash')).toBe('gemini-2.5-flash');
  });

  it('sends a Vertex generateContent payload with systemInstruction + contents', async () => {
    let capturedUrl: string | undefined;
    let capturedBody: any;
    globalThis.fetch = vi.fn(async (url, init) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse((init as any).body);
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"hello":"world"}' }] } }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3 },
        }),
        { status: 200 },
      );
    }) as any;

    const p = new VertexAIProvider();
    const res = await p.callModel(
      'gemini-2.5-flash',
      [
        { role: 'system', content: 'You are X.' },
        { role: 'user', content: 'Extract.' },
      ],
      { jsonMode: true },
    );

    expect(capturedUrl).toContain('us-central1-aiplatform.googleapis.com');
    expect(capturedUrl).toContain('/projects/test-project/');
    expect(capturedUrl).toContain('gemini-2.5-flash:generateContent');
    expect(capturedBody.systemInstruction.parts[0].text).toBe('You are X.');
    expect(capturedBody.contents[0].role).toBe('user');
    expect(capturedBody.contents[0].parts[0].text).toBe('Extract.');
    expect(capturedBody.generationConfig.responseMimeType).toBe('application/json');
    expect(capturedBody.generationConfig.temperature).toBe(0);
    expect(res.content).toBe('{"hello":"world"}');
    expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 3 });
  });

  it('passes responseSchema through generationConfig when provided', async () => {
    let capturedBody: any;
    globalThis.fetch = vi.fn(async (_url, init) => {
      capturedBody = JSON.parse((init as any).body);
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{}' }] } }],
          usageMetadata: {},
        }),
        { status: 200 },
      );
    }) as any;
    const schema = { type: 'object', properties: { invoiceNumber: { type: 'string' } } };
    const p = new VertexAIProvider();
    await p.callModel('gemini-2.5-flash', [{ role: 'user', content: 'x' }], {
      responseSchema: schema,
    });
    expect(capturedBody.generationConfig.responseSchema).toEqual(schema);
  });

  it('converts image_url data-URIs to inline_data parts', async () => {
    let capturedBody: any;
    globalThis.fetch = vi.fn(async (_url, init) => {
      capturedBody = JSON.parse((init as any).body);
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'ok' }] } }],
          usageMetadata: {},
        }),
        { status: 200 },
      );
    }) as any;
    const p = new VertexAIProvider();
    await p.callModel(
      'gemini-2.5-flash',
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'extract' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
          ],
        },
      ],
      {},
    );
    const parts = capturedBody.contents[0].parts;
    expect(parts[0].text).toBe('extract');
    expect(parts[1].inline_data).toEqual({ mime_type: 'image/png', data: 'AAAA' });
  });

  it('throws when GOOGLE_VERTEX_PROJECT is unset', async () => {
    delete process.env.GOOGLE_VERTEX_PROJECT;
    const p = new VertexAIProvider();
    await expect(
      p.callModel('gemini-2.5-flash', [{ role: 'user', content: 'x' }], {}),
    ).rejects.toThrow(/GOOGLE_VERTEX_PROJECT/);
  });
});

describe('toVertexSchema (incidente 2026-06-22 — Vertex 400 no structured output)', () => {
  it('converte type-array nullable do Zod e remove campos nao suportados', async () => {
    const { toVertexSchema } = await import('../vertex.js');
    const input = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      properties: {
        blNumber: { type: ['string', 'null'] },
        total: { type: 'number' },
      },
      required: ['blNumber'],
    };
    const out: any = toVertexSchema(input);
    expect(out.$schema).toBeUndefined();
    expect(out.additionalProperties).toBeUndefined();
    expect(out.properties.blNumber.type).toBe('string');
    expect(out.properties.blNumber.nullable).toBe(true);
    expect(out.properties.total.type).toBe('number');
    expect(out.required).toEqual(['blNumber']);
  });
});
