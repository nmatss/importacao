import { logger } from '../../../shared/utils/logger.js';
import type { AIProvider, ChatMessage, ChatOptions, ChatResponse } from './types.js';

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
    this.apiKey = process.env.IA_LOCAL_API_KEY || '';
    // The single local model that serves every extraction. Defaults to a small
    // Specialist build (unico-docintel) when present; else the qwen3 vision
    // base. Override per hardware (e.g. qwen3-vl:8b on GPU). qwen3 puro é texto.
    this.model = process.env.IA_LOCAL_MODEL || 'qwen3-vl:4b';
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

    const body = {
      model: fullModel,
      messages,
      temperature: 0,
      response_format: responseFormat,
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
      const errorText = await response.text();
      logger.error(
        { status: response.status, error: errorText, model: fullModel },
        'IA_LOCAL API error',
      );
      // Message format mirrors the other providers so isRetryableAiError() can
      // match the embedded HTTP status (4xx are NOT retried).
      throw new Error(`IA_LOCAL API error: ${response.status} - ${errorText}`);
    }

    const result = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const content = result.choices?.[0]?.message?.content;
    if (!content) {
      logger.error({ result }, 'Empty response from IA_LOCAL');
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
