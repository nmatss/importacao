import { isNetworkError, type RetryOptions } from '../../shared/utils/resilience.js';

/**
 * Politica de re-tentativa das integracoes externas (Drive, Sheets, Groups,
 * Odoo).
 *
 * Ate 29/08/2026 nenhuma chamada ao Google ou ao Odoo tinha retry: um 503 de
 * dois segundos derrubava o sweep inteiro e a ingestao do dia. `withRetry` e
 * `CircuitBreaker` existiam em `shared/utils/resilience.ts` e eram usados so
 * pelo modulo de IA.
 *
 * ORCAMENTO: 3 tentativas. O timeout por tentativa continua sendo 30s, entao o
 * pior caso de uma rede completamente blackholed passa de ~30s para ~92s. Isso
 * e deliberado nos caminhos do sweep, e por isso as sondas de health
 * (`testRootAccess`) ficam FORA do retry — sonda que insiste deixa de ser
 * sonda.
 */
export const INTEGRATION_RETRY: Omit<RetryOptions, 'shouldRetry' | 'retryDelayMs'> = {
  attempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
};

/**
 * Status HTTP do erro, quando houver. Cobre os tres formatos que aparecem aqui:
 * Gaxios (`err.response.status`), googleapis (`err.code` numerico) e clientes
 * que expoem `err.status` direto.
 */
export function httpStatusOf(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { response?: { status?: unknown }; status?: unknown; code?: unknown };

  if (typeof e.response?.status === 'number') return e.response.status;
  if (typeof e.status === 'number') return e.status;
  if (typeof e.code === 'number') return e.code;
  return null;
}

/**
 * Re-tenta 429, 408 e 5xx; NAO re-tenta os demais 4xx.
 *
 * 401, 403 e 404 sao configuracao, permissao ou id errado — insistir so atrasa
 * o diagnostico e queima cota. Falha de rede (sem resposta HTTP nenhuma) entra
 * como re-tentavel: e exatamente o soluco transitorio que o retry existe para
 * absorver.
 *
 * Erro que nao e nem rede nem HTTP classificavel NAO e re-tentado: sem saber o
 * que aconteceu, repetir e apostar.
 */
export function shouldRetryIntegration(err: unknown): boolean {
  const status = httpStatusOf(err);

  if (status !== null) {
    if (status === 408 || status === 429) return true;
    return status >= 500 && status <= 599;
  }

  return isNetworkError(err);
}

function headerValue(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== 'object') return null;

  // Gaxios 7 devolve `Headers` (fetch); versoes antigas, objeto simples.
  const asHeaders = headers as { get?: unknown };
  if (typeof asHeaders.get === 'function') {
    const value = (headers as Headers).get(name);
    return typeof value === 'string' ? value : null;
  }

  const record = headers as Record<string, unknown>;
  const key = Object.keys(record).find((k) => k.toLowerCase() === name);
  const raw = key ? record[key] : undefined;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0];
  return null;
}

const MAX_RETRY_AFTER_MS = 60_000;

/**
 * Le `Retry-After` da resposta. Aceita os dois formatos da RFC: segundos
 * ("120") e data HTTP ("Wed, 21 Oct 2026 07:28:00 GMT").
 *
 * Devolve `null` quando o cabecalho nao existe ou nao faz sentido, e ai o
 * backoff exponencial normal vale. O teto evita que um cabecalho absurdo (ou
 * hostil) segure o sweep por horas.
 */
export function retryAfterMsOf(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const response = (err as { response?: { headers?: unknown } }).response;
  const raw = headerValue(response?.headers, 'retry-after');
  if (!raw) return null;

  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    const ms = Number(trimmed) * 1000;
    return Math.min(ms, MAX_RETRY_AFTER_MS);
  }

  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  const ms = at - Date.now();
  if (ms <= 0) return 0;
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}

/** Opcoes prontas para `withRetry` numa chamada de integracao externa. */
export const integrationRetryOptions: RetryOptions = {
  ...INTEGRATION_RETRY,
  shouldRetry: shouldRetryIntegration,
  retryDelayMs: retryAfterMsOf,
};
