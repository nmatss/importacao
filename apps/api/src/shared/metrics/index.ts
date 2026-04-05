import { collectDefaultMetrics, Counter, Histogram, Gauge, Registry } from 'prom-client';
import type { Request, Response, NextFunction } from 'express';

export const register = new Registry();

// Collect default Node.js metrics (event loop lag, memory, CPU, etc.)
collectDefaultMetrics({ register });

// Custom counter: total HTTP requests
export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'path', 'status_code'] as const,
  registers: [register],
});

// Custom histogram: HTTP request duration
export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'path'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

// Custom gauge: active queue jobs
export const queueJobsActive = new Gauge({
  name: 'queue_jobs_active',
  help: 'Number of currently active jobs per queue',
  labelNames: ['queue_name'] as const,
  registers: [register],
});

// Custom histogram: database query duration
export const dbQueryDuration = new Histogram({
  name: 'db_query_duration_seconds',
  help: 'Duration of database queries in seconds',
  labelNames: ['operation'] as const,
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [register],
});

// Custom histogram: external integration request duration
export const integrationRequestDuration = new Histogram({
  name: 'integration_request_duration_seconds',
  help: 'Duration of external integration requests in seconds',
  labelNames: ['provider'] as const,
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [register],
});

// Custom gauge: currently running validation checks
export const validationChecksRunning = new Gauge({
  name: 'validation_checks_running',
  help: 'Number of currently running validation check sets',
  registers: [register],
});

/**
 * Normalize path to avoid high-cardinality labels.
 * Replaces UUID-like and numeric path segments with placeholders.
 */
function normalizePath(url: string): string {
  return url
    .split('?')[0]
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/\d+/g, '/:id');
}

/**
 * Express middleware that instruments every request with Prometheus metrics.
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const end = httpRequestDuration.startTimer();
  const path = normalizePath(req.path);

  res.on('finish', () => {
    httpRequestsTotal.inc({
      method: req.method,
      path,
      status_code: String(res.statusCode),
    });
    end({ method: req.method, path });
  });

  next();
}
