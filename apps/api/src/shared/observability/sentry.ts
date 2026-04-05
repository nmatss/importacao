import * as Sentry from '@sentry/node';

export function initSentry() {
  if (!process.env.SENTRY_DSN) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,
    release: process.env.APP_VERSION,
  });
}

export { Sentry };
