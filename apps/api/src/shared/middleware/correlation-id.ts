import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';
import type { Logger } from 'pino';

declare global {
  namespace Express {
    interface Request {
      correlationId: string;
      log: Logger;
    }
  }
}

export function correlationId(req: Request, res: Response, next: NextFunction): void {
  const id = (req.headers['x-correlation-id'] as string) || crypto.randomUUID();
  req.correlationId = id;
  req.log = logger.child({ correlationId: id });
  res.setHeader('x-correlation-id', id);
  next();
}
