import pino from 'pino';
import { requestContext } from '../observability/context.js';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
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
