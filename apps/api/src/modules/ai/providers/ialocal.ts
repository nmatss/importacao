import { logger } from '../../../shared/utils/logger.js';
import type { AIProvider, ChatMessage, ChatOptions, ChatResponse } from './types.js';

const DEFAULT_ALLOWED_HOSTS = ['ia-local-gateway', 'localhost', '127.0.0.1', '::1'];

function allowedHosts(): Set<string> {
  const raw = process.env.IA_LOCAL_ALLOWED_HOSTS || DEFAULT_ALLOWED_HOSTS.join(',');
  return new Set(
    raw
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
}

function assertAllowedEndpoint(baseUrl: string): void {
  if (!baseUrl) return;

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('IA_LOCAL_BASE_URL invalido');
  }

  const host = parsed.hostname.toLowerCase();
  if (!allowedHosts().has(host)) {
    throw new Error('IA_LOCAL_BASE_URL bloqueado por IA_LOCAL_ALLOWED_HOSTS');
  }
}

/**
 * IA_LOCAL provider — talks to the Grupo Uni.co self-hosted AI platform
 * (Ollama behind a bearer-auth gateway, exposed as an OpenAI-compatible API).
 * See the `IA_LOCAL` repo: serving stays 100% on-premise, so the sensitive
 * import documents (Invoice/BL/PL/espelho) never leave the perimeter — same
 * privacy guarantee that motivated Vertex, but without any paid egress.
 *
 * Multimodal (vision) requests use the standard OpenAI `image_url` data-URL
 * content parts, which Ollama's /v1 layer accepts for VLM models
 * (e.g. qwen3-vl). The model is configured by IA_LOCAL_MODEL — see
 * `normalizeModel`.
 */
export class IALocalProvider implements AIProvider {
  readonly name = 'ialocal' as const;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor() {
    // Gateway base URL, e.g. http://ia-local-gateway:8443/v1 (reachable from
    // the importacao API container over the shared network). No default — env
    // validation (env.ts superRefine) requires it when AI_PROVIDER=ialocal.
    this.baseUrl = (process.env.IA_LOCAL_BASE_URL || '').replace(/\/+$/, '');
    assertAllowedEndpoint(this.baseUrl);
    this.apiKey = process.env.IA_LOCAL_API_KEY || '';
    // The single local model that serves every extraction. Defaults to a small
    // Specialist build. Override per hardware only through IA_LOCAL_MODEL.
    this.model = process.env.IA_LOCAL_MODEL || 'unico-docintel';
  }

  /**
   * Every upstream caller asks for a Gemini alias (the fallback chain is
   * 'gemini-2.5-flash' → 'gemini-2.5-pro' → ...). IA_LOCAL serves ONE local
   * model, so we collapse any requested name to IA_LOCAL_MODEL. This is
   * idempotent (mapping the local name returns itself), which lets the service
   * dedupe the fallback chain to a single entry and keeps cost tracking keyed
   * on the real local model (priced at 0 — it's not in the pricing table).
   */
  normalizeModel(_model: string): string {
    return this.model;
  }

  async callModel(
    model: string,
    messages: ChatMessage[],
    options: ChatOptions,
  ): Promise<ChatResponse> {
    const fullModel = this.normalizeModel(model);
    const url = `${this.baseUrl}/chat/completions`;

    // JSON enforcement: Ollama's OpenAI-compatible layer reliably honours
    // `response_format: { type: 'json_object' }`. The stricter `json_schema`
    // mode is newer and not guaranteed on every Ollama build / model, and a
    // 400 there would burn an (expensive, CPU-bound) inference for nothing.
    // The prompts already spell out the schema and the post-extraction harness
    // zod-validates, so json_object is the safe, broadly-compatible choice.
    const wantsJson = options.responseSchema != null || options.jsonMode !== false;
    const responseFormat = wantsJson ? { type: 'json_object' } : { type: 'text' };
    const numPredict =
      options.maxOutputTokens && options.maxOutputTokens > 0
        ? options.maxOutputTokens
        : Number(process.env.IA_LOCAL_NUM_PREDICT || '1536');
    const numCtx = Number(process.env.IA_LOCAL_NUM_CTX || '8192');

    const body = {
      model: fullModel,
      messages,
      temperature: 0,
      stream: false,
      response_format: responseFormat,
      options: {
        temperature: 0,
        ...(Number.isFinite(numPredict) && numPredict > 0 ? { num_predict: numPredict } : {}),
        ...(Number.isFinite(numCtx) && numCtx > 0 ? { num_ctx: numCtx } : {}),
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!response.ok) {
      await response.text().catch(() => '');
      logger.error({ status: response.status, model: fullModel }, 'IA_LOCAL API error');
      // Message format mirrors the other providers so isRetryableAiError() can
      // match the embedded HTTP status (4xx are NOT retried).
      throw new Error(`IA_LOCAL API error: ${response.status}`);
    }

    const result = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const content = result.choices?.[0]?.message?.content;
    if (!content) {
      logger.error({ model: fullModel }, 'Empty response from IA_LOCAL');
      throw new Error('Empty response from IA_LOCAL API');
    }

    return {
      content,
      usage: {
        inputTokens: result.usage?.prompt_tokens ?? 0,
        outputTokens: result.usage?.completion_tokens ?? 0,
      },
    };
  }
}
