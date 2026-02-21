import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger.js';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  logger.error({ err }, err.message);

  if (err instanceof ZodError) {
    const errors = err.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    return res.status(400).json({
      success: false,
      error: 'Erro de validação',
      details: errors,
    });
  }

  const statusCode = 'statusCode' in err ? (err as any).statusCode : 500;
  const message =
    statusCode === 500 ? 'Erro interno do servidor' : err.message;

  return res.status(statusCode).json({
    success: false,
    error: message,
  });
}
