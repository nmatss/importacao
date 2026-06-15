import pino from 'pino';
import { requestContext } from '../observability/context.js';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  // Defense in depth: the bearer is never placed in a logged field today, but
  // redact these keys so a future log line can't leak a token/secret.
  redact: {
    paths: [
      'authorization',
      '*.authorization',
      'token',
      '*.token',
      'password',
      '*.password',
      'apiKey',
      '*.apiKey',
      'privateKey',
      '*.privateKey',
      'IA_LOCAL_API_KEY',
      'OPENROUTER_API_KEY',
      'GOOGLE_VERTEX_PRIVATE_KEY',
      'GOOGLE_DRIVE_PRIVATE_KEY',
      'req.headers.authorization',
      'headers.authorization',
    ],
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
