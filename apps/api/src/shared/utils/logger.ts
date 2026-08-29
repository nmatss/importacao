import pino from 'pino';
import { requestContext } from '../observability/context.js';

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Chaves cujo valor nunca aparece em log.
 *
 * Defense in depth: the bearer is never placed in a logged field today, but
 * redact these keys so a future log line can't leak a token/secret.
 *
 * Exportada para que o teste exercite a LISTA REAL — a redacao do pino compara
 * a chave inteira, entao `userEmail` nao casava com `email` nem com `*.email` e
 * o endereco corporativo saia em claro.
 */
export const REDACT_PATHS = [
  'authorization',
  '*.authorization',
  'token',
  '*.token',
  'password',
  '*.password',
  'apiKey',
  '*.apiKey',
  'api_key',
  '*.api_key',
  'secret',
  '*.secret',
  'clientSecret',
  '*.clientSecret',
  'client_secret',
  '*.client_secret',
  'jwtSecret',
  '*.jwtSecret',
  'privateKey',
  '*.privateKey',
  'private_key',
  '*.private_key',
  'pass',
  '*.pass',
  'smtpPass',
  '*.smtpPass',
  'imapPass',
  '*.imapPass',
  'odooPassword',
  '*.odooPassword',
  'sydleApiToken',
  '*.sydleApiToken',
  'sydlePassword',
  '*.sydlePassword',
  'sydleCookie',
  '*.sydleCookie',
  'CERT_API_KEY',
  'IA_LOCAL_API_KEY',
  'JWT_SECRET',
  'OPENROUTER_API_KEY',
  'SMTP_PASS',
  'IMAP_PASS',
  'ODOO_PASSWORD',
  'SYDLE_API_TOKEN',
  'SYDLE_PASSWORD',
  'SYDLE_USER',
  'GOOGLE_VERTEX_PRIVATE_KEY',
  'GOOGLE_DRIVE_PRIVATE_KEY',
  'email',
  '*.email',
  // `userEmail` nao casa com `email`/`*.email` — a redacao do pino compara
  // a chave inteira. `google-groups.service.ts` loga `{ err, userEmail }` a
  // cada falha de checagem de grupo, o que gravava endereco corporativo em
  // claro no log.
  'userEmail',
  '*.userEmail',
  'client_email',
  '*.client_email',
  'clientEmail',
  '*.clientEmail',
  'from',
  '*.from',
  'fromAddress',
  '*.fromAddress',
  'recipient',
  '*.recipient',
  'recipientEmail',
  '*.recipientEmail',
  'subject',
  '*.subject',
  'body',
  '*.body',
  'bodyText',
  '*.bodyText',
  'messageId',
  '*.messageId',
  'transportId',
  '*.transportId',
  'gmailId',
  '*.gmailId',
  'filename',
  '*.filename',
  'originalFilename',
  '*.originalFilename',
  'searchQuery',
  '*.searchQuery',
  'gmailQuery',
  '*.gmailQuery',
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  'err.config.headers.Authorization',
  'err.config.headers.authorization',
  'err.options.headers.Authorization',
  'err.options.headers.authorization',
  'error.config.headers.Authorization',
  'error.config.headers.authorization',
  'error.options.headers.Authorization',
  'error.options.headers.authorization',
  'cookie',
  '*.cookie',
];

export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
  },
  mixin() {
    const ctx = requestContext.getStore();
    if (!ctx) return {};
    return { requestId: ctx.requestId, ...(ctx.userId && { userId: ctx.userId }) };
  },
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
      },
    },
  }),
});
