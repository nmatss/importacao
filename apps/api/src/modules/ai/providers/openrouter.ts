import { logger } from '../../../shared/utils/logger.js';
import type { AIProvider, ChatMessage, ChatOptions, ChatResponse } from './types.js';

/**
 * OpenRouter chat-completions provider. Mirrors the original `callOpenRouter`
 * helper that lived inline in service.ts, with structured-output support
 * (response_format: json_schema) when ChatOptions.responseSchema is set.
 */
export class OpenRouterProvider implements AIProvider {
  readonly name = 'openrouter' as const;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor() {
    this.baseUrl = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
    this.apiKey = process.env.OPENROUTER_API_KEY || '';
  }

  normalizeModel(model: string): string {
    // OpenRouter requires a provider prefix; we standardize on Google's
    // Gemini models, so add 'google/' when missing.
    if (model.includes('/')) return model;
    return `google/${model}`;
  }

  async callModel(
    model: string,
    messages: ChatMessage[],
    options: ChatOptions,
  ): Promise<ChatResponse> {
    const fullModel = this.normalizeModel(model);
    const url = `${this.baseUrl}/chat/completions`;

    let responseFormat: Record<string, unknown>;
    if (options.responseSchema) {
      responseFormat = {
        type: 'json_schema',
        json_schema: {
          name: 'extraction_response',
          strict: false,
          schema: options.responseSchema,
        },
      };
    } else if (options.jsonMode !== false) {
      responseFormat = { type: 'json_object' };
    } else {
      responseFormat = { type: 'text' };
    }

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
        'HTTP-Referer': 'importacao-system',
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        { status: response.status, error: errorText, model: fullModel },
        'OpenRouter API error',
      );
      throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
    }

    const result = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const content = result.choices?.[0]?.message?.content;
    if (!content) {
      logger.error({ result }, 'Empty response from OpenRouter');
      throw new Error('Empty response from OpenRouter API');
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
