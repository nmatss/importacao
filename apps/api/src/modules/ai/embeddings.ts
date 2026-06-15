/**
 * Embeddings client for the RAG layer — talks to the IA_LOCAL gateway's
 * OpenAI-compatible /v1/embeddings endpoint (Ollama serving bge-m3, on-prem).
 *
 * NOT YET WIRED: the active RAG path (rag/retriever.ts) is lexical/in-memory —
 * this module is the FOUNDATION for the future SEMANTIC path (e.g. ranking the
 * free-text `premissas` by meaning) and has no production caller today. It
 * exists so the semantic upgrade is a drop-in when a KB grows enough to need it.
 * See providers/ialocal.ts for the chat half and the privacy rationale
 * (everything stays inside the perimeter).
 *
 * Intentionally provider-agnostic at the call sites: only this module knows the
 * embeddings come from IA_LOCAL, so a future swap (or a hosted fallback) is
 * contained here.
 */

import { logger } from '../../shared/utils/logger.js';

/** bge-m3 native dimensionality. If a persisted vector index is ever adopted
 *  (pgvector is a conditional future, not in use today), its column must match. */
export const EMBEDDING_DIM = 1024;

function config(): { baseUrl: string; apiKey: string; model: string } {
  const baseUrl = (process.env.IA_LOCAL_BASE_URL || '').replace(/\/+$/, '');
  const apiKey = process.env.IA_LOCAL_API_KEY || '';
  // bge-m3 is the embed model bootstrapped by IA_LOCAL; override per deployment.
  const model = process.env.IA_LOCAL_EMBED_MODEL || 'bge-m3';
  return { baseUrl, apiKey, model };
}

/** Whether the embeddings backend is configured (RAG can be attempted). */
export function embeddingsAvailable(): boolean {
  const { baseUrl, apiKey } = config();
  return baseUrl.length > 0 && apiKey.length > 0;
}

/**
 * Embed a batch of texts. Returns one vector per input, in order. Throws on a
 * misconfigured/unreachable backend — callers that want RAG to degrade
 * gracefully should guard with embeddingsAvailable() and treat failures as
 * "no retrieved context" rather than a hard error.
 */
export async function embedTexts(texts: string[], signal?: AbortSignal): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { baseUrl, apiKey, model } = config();
  if (!baseUrl || !apiKey) {
    throw new Error('IA_LOCAL embeddings not configured (IA_LOCAL_BASE_URL / IA_LOCAL_API_KEY)');
  }

  const response = await fetch(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, input: texts }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error({ status: response.status, error: errorText, model }, 'IA_LOCAL embeddings error');
    // Same "error: <status>" shape as the chat providers, for consistent
    // retry classification upstream.
    throw new Error(`IA_LOCAL embeddings error: ${response.status} - ${errorText}`);
  }

  const result = (await response.json()) as {
    data?: Array<{ embedding: number[]; index: number }>;
  };
  const data = result.data;
  if (!Array.isArray(data) || data.length !== texts.length) {
    throw new Error(
      `IA_LOCAL embeddings: expected ${texts.length} vectors, got ${data?.length ?? 0}`,
    );
  }
  // Honour the API's index field rather than trusting array order.
  const out = new Array<number[]>(texts.length);
  for (const row of data) {
    out[row.index] = row.embedding;
  }
  return out;
}

/** Embed a single text. Convenience wrapper over embedTexts. */
export async function embedText(text: string, signal?: AbortSignal): Promise<number[]> {
  const [vec] = await embedTexts([text], signal);
  return vec;
}

/**
 * Cosine similarity between two equal-length vectors — for in-process semantic
 * ranking and tests. (If a persisted vector store is ever adopted it would do
 * the same at the DB level; none exists today.)
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
