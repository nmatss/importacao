import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { sql } from 'drizzle-orm';
import { errorHandler } from './shared/middleware/error-handler.js';
import { logger } from './shared/utils/logger.js';
import { correlationId } from './shared/middleware/correlation-id.js';
import { apiRouter } from './routes.js';
import { db } from './shared/database/connection.js';
import { metricsMiddleware, register } from './shared/metrics/index.js';
import { openapiSpec } from './docs/openapi.js';

const app = express();

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
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

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
app.get('/metrics', (req, res, next) => {
  const expectedToken = process.env.METRICS_TOKEN;
  const allowedIps = (process.env.METRICS_ALLOWED_IPS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const providedToken = req.header('x-metrics-token');
  const clientIp = req.ip || req.socket.remoteAddress || '';

  // Allow if token matches
  if (expectedToken && providedToken === expectedToken) return next();
  // Allow if IP is in allow-list (defaults to localhost only)
  const defaultAllow = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
  if ([...defaultAllow, ...allowedIps].some((ip) => clientIp === ip || clientIp.endsWith(ip))) return next();

  res.status(401).json({ success: false, error: 'Unauthorized' });
}, async (_req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).end(String(err));
  }
});

// OpenAPI / Swagger docs
app.get('/api/docs/openapi.json', (_req, res) => {
  res.json(openapiSpec);
});
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec));

// API routes
app.use('/api', apiRouter);

// Health check
app.get('/health', async (_req, res) => {
  try {
    await db.execute(sql`SELECT 1`);
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'error', timestamp: new Date().toISOString() });
  }
});

// Error handler
app.use(errorHandler);

export { app };
