/**
 * Common provider abstraction for AI chat completions. Concrete providers
 * (OpenRouter, Vertex AI) implement this and the AIService delegates based
 * on the AI_PROVIDER env var.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

export interface ChatOptions {
  jsonMode?: boolean;
  /** Optional JSON Schema for structured-output mode. When set, both providers
   *  constrain the model to produce a JSON value matching the schema. */
  responseSchema?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatResponse {
  content: string;
  usage: ChatUsage;
}

export interface AIProvider {
  readonly name: 'openrouter' | 'vertex';
  /**
   * Normalize a generic model id for the concrete provider.
   * Example: 'gemini-2.5-flash' → 'google/gemini-2.5-flash' for OpenRouter,
   * unchanged for Vertex.
   */
  normalizeModel(model: string): string;
  callModel(model: string, messages: ChatMessage[], options: ChatOptions): Promise<ChatResponse>;
}
