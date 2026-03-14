import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { sql } from 'drizzle-orm';
import { errorHandler } from './shared/middleware/error-handler.js';
import { logger } from './shared/utils/logger.js';
import { correlationId } from './shared/middleware/correlation-id.js';
import { apiRouter } from './routes.js';
import { db } from './shared/database/connection.js';

const app = express();

// Security headers
app.use(helmet());

// CORS
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

// Correlation ID (before request logging)
app.use(correlationId);

// Request logging
app.use((req, _res, next) => {
  const log = req.log || logger;
  log.info({ method: req.method, url: req.url }, 'incoming request');
  next();
});

// API routes
app.use('/api', apiRouter);

// Health check
app.get('/health', async (_req, res) => {
  try {
    await db.execute(sql`SELECT 1`);
    res.json({ status: 'ok', timestamp: new Date().toISOString(), db: 'connected' });
  } catch {
    res
      .status(503)
      .json({ status: 'degraded', timestamp: new Date().toISOString(), db: 'disconnected' });
  }
});

// Error handler
app.use(errorHandler);

export { app };
