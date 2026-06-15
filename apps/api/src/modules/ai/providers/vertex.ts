import { auth as googleAuth } from '@googleapis/drive';
import { logger } from '../../../shared/utils/logger.js';
import type { AIProvider, ChatMessage, ChatOptions, ChatResponse } from './types.js';

/**
 * Google Vertex AI provider implemented over the REST API + google-auth-library.
 *
 * Why REST (not the @google-cloud/vertexai SDK):
 * - We already have google-auth-library in the tree (Drive uses it).
 * - The SDK pulls grpc + protobuf — heavy and duplicates capabilities we have.
 * - The REST shape is stable and trivially mockable in tests.
 *
 * Privacy guarantee — the reason this provider exists (Nicolas, 2026-05-21):
 * "Vertex AI... lá é garantia 100% que não é usado os dados pra treinar
 * model." Vertex AI (Google Cloud Generative AI APIs) does not use customer
 * prompts/responses for training by default. OpenRouter routes through
 * third-party providers without that contractual guarantee.
 */

interface VertexAuthState {
  client: { getAccessToken: () => Promise<string | null | undefined> } | null;
}

const authState: VertexAuthState = { client: null };

function getAuthClient(): { getAccessToken: () => Promise<string | null | undefined> } {
  if (authState.client) return authState.client;

  // Prefer a dedicated Vertex/Gemini service account (least privilege: this SA
  // only needs roles/aiplatform.user). Falls back to the Drive SA so existing
  // single-SA setups keep working unchanged.
  const clientEmail =
    process.env.GOOGLE_VERTEX_CLIENT_EMAIL || process.env.GOOGLE_DRIVE_CLIENT_EMAIL;
  const privateKey = (
    process.env.GOOGLE_VERTEX_PRIVATE_KEY || process.env.GOOGLE_DRIVE_PRIVATE_KEY
  )?.replace(/\\n/g, '\n');
  if (!clientEmail || !privateKey) {
    throw new Error(
      'Vertex provider: set GOOGLE_VERTEX_CLIENT_EMAIL / GOOGLE_VERTEX_PRIVATE_KEY (or reuse GOOGLE_DRIVE_CLIENT_EMAIL / GOOGLE_DRIVE_PRIVATE_KEY).',
    );
  }
  const client = new googleAuth.GoogleAuth({
    credentials: { client_email: clientEmail, private_key: privateKey },
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  authState.client = client as unknown as VertexAuthState['client'];
  return authState.client!;
}

interface VertexPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
}

interface VertexContent {
  role: 'user' | 'model';
  parts: VertexPart[];
}

/**
 * Convert the chat-style messages used by AIService to the contents[] array
 * Vertex expects. System messages are collapsed into the `systemInstruction`
 * field (Vertex's standard place for them).
 */
function toVertexBody(
  messages: ChatMessage[],
  options: ChatOptions,
): {
  systemInstruction?: { parts: VertexPart[] };
  contents: VertexContent[];
  generationConfig: Record<string, unknown>;
} {
  const sysParts: VertexPart[] = [];
  const contents: VertexContent[] = [];

  for (const msg of messages) {
    const parts: VertexPart[] = [];
    if (typeof msg.content === 'string') {
      parts.push({ text: msg.content });
    } else {
      for (const p of msg.content) {
        if (p.type === 'text' && p.text) parts.push({ text: p.text });
        if (p.type === 'image_url' && p.image_url?.url) {
          // Expect data URIs from the upstream caller (data:image/png;base64,...).
          const url = p.image_url.url;
          const match = url.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            parts.push({ inline_data: { mime_type: match[1], data: match[2] } });
          }
        }
      }
    }
    if (msg.role === 'system') {
      sysParts.push(...parts);
    } else if (msg.role === 'assistant') {
      contents.push({ role: 'model', parts });
    } else {
      contents.push({ role: 'user', parts });
    }
  }

  const generationConfig: Record<string, unknown> = {
    temperature: 0,
  };
  if (options.responseSchema) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = options.responseSchema;
  } else if (options.jsonMode !== false) {
    generationConfig.responseMimeType = 'application/json';
  }

  return {
    systemInstruction: sysParts.length > 0 ? { parts: sysParts } : undefined,
    contents,
    generationConfig,
  };
}

export class VertexAIProvider implements AIProvider {
  readonly name = 'vertex' as const;
  private readonly project: string;
  private readonly location: string;

  constructor() {
    this.project = process.env.GOOGLE_VERTEX_PROJECT || '';
    this.location = process.env.GOOGLE_VERTEX_LOCATION || 'us-central1';
    if (!this.project) {
      logger.warn(
        'Vertex provider constructed without GOOGLE_VERTEX_PROJECT — calls will fail until configured.',
      );
    }
  }

  normalizeModel(model: string): string {
    // Vertex uses bare names; strip any "google/" prefix from upstream calls.
    return model.replace(/^google\//, '');
  }

  async callModel(
    model: string,
    messages: ChatMessage[],
    options: ChatOptions,
  ): Promise<ChatResponse> {
    if (!this.project) {
      throw new Error('Vertex provider: GOOGLE_VERTEX_PROJECT not configured');
    }
    const auth = getAuthClient();
    const token = (await auth.getAccessToken()) as string;
    if (!token) throw new Error('Vertex provider: failed to mint access token');

    const fullModel = this.normalizeModel(model);
    const url = `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.project}/locations/${this.location}/publishers/google/models/${fullModel}:generateContent`;

    const body = toVertexBody(messages, options);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!response.ok) {
      await response.text().catch(() => '');
      logger.error({ status: response.status, model: fullModel }, 'Vertex API error');
      throw new Error(`Vertex API error: ${response.status}`);
    }

    const result = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };

    const textParts = result.candidates?.[0]?.content?.parts ?? [];
    const content = textParts.map((p) => p.text ?? '').join('');
    if (!content) {
      logger.error({ model: fullModel }, 'Empty response from Vertex');
      throw new Error('Empty response from Vertex API');
    }

    return {
      content,
      usage: {
        inputTokens: result.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: result.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }
}
