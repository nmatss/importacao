import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { sql } from 'drizzle-orm';
import { errorHandler } from './shared/middleware/error-handler.js';
import { logger } from './shared/utils/logger.js';
import { correlationId } from './shared/middleware/correlation-id.js';
import { apiRouter } from './routes.js';
import { healthRoutes } from './modules/health/routes.js';
import { db } from './shared/database/connection.js';
import { metricsMiddleware, register } from './shared/metrics/index.js';
import { openapiSpec } from './docs/openapi.js';

const app = express();

// Trust proxy — required so req.ip reflects the real client behind our reverse
// proxy (nginx/load balancer) instead of the proxy's own address. This is what
// per-IP rate limiting and the /metrics IP allow-list rely on: without it every
// client shares the proxy's IP (one rate-limit bucket) and the allow-list check
// is meaningless.
//
// SECURITY: never blindly trust all proxies ('true'), which would let any
// client spoof X-Forwarded-For and forge req.ip. Default to 'loopback' (the
// proxy runs on the same host). For multi-hop setups, set TRUST_PROXY to the
// number of trusted proxy hops (e.g. "1") or an Express trust-proxy value
// (a subnet/IP/CSV like "10.0.0.0/8"). See:
// https://expressjs.com/en/guide/behind-proxies.html
const trustProxyEnv = process.env.TRUST_PROXY?.trim();
if (trustProxyEnv) {
  // A bare integer means "trust N hops"; anything else is passed through as an
  // Express trust-proxy expression (IP/subnet/CSV). 'false'/'true' are honored
  // as booleans for completeness, but 'true' is discouraged in production.
  if (/^\d+$/.test(trustProxyEnv)) {
    app.set('trust proxy', Number(trustProxyEnv));
  } else if (trustProxyEnv === 'true' || trustProxyEnv === 'false') {
    app.set('trust proxy', trustProxyEnv === 'true');
  } else {
    app.set('trust proxy', trustProxyEnv);
  }
} else {
  // Safe default: only trust a proxy on the loopback interface.
  app.set('trust proxy', 'loopback');
}

// Security headers
app.use(helmet());

// CORS — fail-fast in production if CORS_ORIGIN not set
if (process.env.NODE_ENV === 'production' && !process.env.CORS_ORIGIN) {
  logger.fatal(
    'CORS_ORIGIN environment variable is required in production. Refusing to start with localhost fallback.',
  );
  throw new Error('CORS_ORIGIN must be set in production');
}
app.use(
  cors({
    origin: process.env.CORS_ORIGIN?.split(',') || [
      'http://localhost:5173',
      'http://localhost:8080',
    ],
    credentials: true,
  }),
);
// JSON body limit: 2MB is plenty for any structured request — the largest
// shape this API accepts via JSON is a process with extracted AI data, which
// is well under 100KB. File uploads go through multer separately at 50MB.
// Keeping this tight reduces the DoS surface on unauth endpoints and makes
// the PayloadTooLargeError path in error-handler actually reachable.
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Prometheus metrics (before request logging so all requests are captured)
app.use(metricsMiddleware);

// Correlation ID (before request logging)
app.use(correlationId);

// Request logging
app.use((req, _res, next) => {
  const log = req.log || logger;
  log.info({ method: req.method, url: req.url }, 'incoming request');
  next();
});

// Prometheus metrics endpoint — protected by token or IP allow-list
app.get(
  '/metrics',
  (req, res, next) => {
    const expectedToken = process.env.METRICS_TOKEN;
    const allowedIps = (process.env.METRICS_ALLOWED_IPS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const providedToken = req.header('x-metrics-token');
    const clientIp = req.ip || req.socket.remoteAddress || '';

    // Allow if token matches
    if (expectedToken && providedToken === expectedToken) return next();
    // Allow if IP is in allow-list (defaults to localhost only). Compare by
    // normalized equality — the previous endsWith() was too loose (e.g. a
    // client IP ending in "1" would match "::1", and "10.0.0.1" would match a
    // trailing ".1"). Normalize the IPv4-mapped IPv6 prefix so 127.0.0.1 and
    // ::ffff:127.0.0.1 are treated as the same address.
    const normalizeIp = (ip: string) => ip.replace(/^::ffff:/, '');
    const isPrivateNetworkIp = (ip: string) => {
      const normalized = normalizeIp(ip);
      if (/^10\./.test(normalized)) return true;
      if (/^192\.168\./.test(normalized)) return true;
      const match = normalized.match(/^172\.(\d{1,2})\./);
      return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
    };
    const defaultAllow = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
    const normalizedClient = normalizeIp(clientIp);
    if ([...defaultAllow, ...allowedIps].some((ip) => normalizeIp(ip) === normalizedClient))
      return next();
    if (
      process.env.METRICS_ALLOW_PRIVATE_NETWORKS === 'true' &&
      isPrivateNetworkIp(normalizedClient)
    ) {
      return next();
    }

    res.status(401).json({ success: false, error: 'Unauthorized' });
  },
  async (_req, res) => {
    try {
      res.set('Content-Type', register.contentType);
      res.end(await register.metrics());
    } catch (err) {
      res.status(500).end(String(err));
    }
  },
);

// OpenAPI / Swagger docs
app.get('/api/docs/openapi.json', (_req, res) => {
  res.json(openapiSpec);
});
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec));

// API routes
app.use('/api', apiRouter);

// Health check (legacy endpoint — simple DB check)
app.get('/health', async (_req, res) => {
  try {
    await db.execute(sql`SELECT 1`);
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'error', timestamp: new Date().toISOString() });
  }
});

// Health probes — /health/live (liveness) + /health/ready (DB + Redis)
app.use('/health', healthRoutes);

// Error handler
app.use(errorHandler);

export { app };
