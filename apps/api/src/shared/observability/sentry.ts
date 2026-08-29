import * as Sentry from '@sentry/node';
import type { ErrorEvent } from '@sentry/node';

/**
 * Chaves cujo valor nunca sai desta aplicacao para o Sentry.
 *
 * A lista de redacao do pino (`shared/utils/logger.ts`) atua apenas no log
 * local: o payload que o SDK do Sentry monta e outro caminho de saida e nao
 * passa por ela. Sem este filtro, um erro dentro de um handler autenticado
 * levaria corpo de requisicao, header `Authorization` e endereco corporativo
 * para um servico externo.
 */
const SENSITIVE_KEYS = new Set([
  'authorization',
  'cookie',
  'token',
  'password',
  'pass',
  'secret',
  'apikey',
  'api_key',
  'clientsecret',
  'client_secret',
  'privatekey',
  'private_key',
  'email',
  'useremail',
  'clientemail',
  'client_email',
  'recipient',
  'recipientemail',
  'fromemail',
  'actoremail',
  'senderemail',
]);

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase());
}

function scrubValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? REDACTED : scrubValue(item, depth + 1);
  }
  return out;
}

/**
 * Remove corpo de requisicao, headers de autenticacao e campos de e-mail antes
 * do evento sair. Exportada para teste — nao lanca: se o scrubbing falhar, o
 * evento e descartado em vez de ser enviado sem filtro.
 */
export function scrubSentryEvent<T extends ErrorEvent>(event: T): T | null {
  try {
    if (event.request) {
      // Corpo e query string carregam dado de processo, fornecedor e busca
      // livre; nao ha caso de uso de depuracao que justifique exporta-los.
      delete event.request.data;
      delete event.request.cookies;
      delete event.request.query_string;

      if (event.request.headers) {
        for (const key of Object.keys(event.request.headers)) {
          if (isSensitiveKey(key)) event.request.headers[key] = REDACTED;
        }
      }
    }

    if (event.user) {
      delete event.user.email;
      delete event.user.ip_address;
      delete event.user.username;
    }

    if (event.extra) event.extra = scrubValue(event.extra, 0) as typeof event.extra;
    if (event.contexts) event.contexts = scrubValue(event.contexts, 0) as typeof event.contexts;

    return event;
  } catch {
    return null;
  }
}

export function initSentry() {
  if (!process.env.SENTRY_DSN) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,
    release: process.env.APP_VERSION,
    // Explicito: o SDK nao deve anexar IP, cookie nem corpo por conta propria.
    sendDefaultPii: false,
    beforeSend: (event) => scrubSentryEvent(event),
  });
}

export { Sentry };
