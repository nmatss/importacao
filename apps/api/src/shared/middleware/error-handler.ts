import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import multer from 'multer';
import { AppError, ValidationError } from '../errors/index.js';
import { logger } from '../utils/logger.js';
import { Sentry } from '../observability/sentry.js';

// body-parser attaches `.type` to its errors and (in newer versions) a
// `.status` property. We match by `.type` because that's stable across
// middleware versions. See https://github.com/expressjs/body-parser#errors
interface BodyParserError extends Error {
  type?: string;
  status?: number;
  length?: number;
  limit?: number;
}

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  logger.error({ err }, err.message);

  // body-parser: payload too large — MUST return 413, not fall through to 500.
  // Without this branch, unauthenticated clients can POST oversized JSON and
  // see only a generic "Erro interno do servidor" message — which is both
  // confusing and useful for fingerprinting the limit.
  const bpErr = err as BodyParserError;
  if (bpErr.type === 'entity.too.large' || bpErr.status === 413) {
    return res.status(413).json({
      success: false,
      error:
        'Corpo da requisição excede o limite máximo (2MB). Para arquivos, use o endpoint de upload de documentos.',
    });
  }
  // body-parser: malformed JSON
  if (bpErr.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({
      success: false,
      error: 'JSON inválido no corpo da requisição.',
    });
  }
  // body-parser: unsupported charset or encoding
  if (bpErr.type === 'charset.unsupported' || bpErr.type === 'encoding.unsupported') {
    return res.status(415).json({
      success: false,
      error: 'Encoding ou charset não suportado.',
    });
  }

  // Multer errors (file upload issues)
  if (err instanceof multer.MulterError) {
    const messages: Record<string, string> = {
      LIMIT_FILE_SIZE: 'Arquivo excede o tamanho máximo de 50MB',
      LIMIT_UNEXPECTED_FILE: 'Campo de arquivo inesperado',
      LIMIT_FILE_COUNT: 'Muitos arquivos enviados',
    };
    return res.status(400).json({
      success: false,
      error: messages[err.code] || `Erro no upload: ${err.message}`,
    });
  }

  // Multer file filter errors (wrong MIME type)
  if (err.message?.includes('Tipo de arquivo não permitido')) {
    return res.status(400).json({
      success: false,
      error: err.message,
    });
  }

  if (err instanceof ZodError) {
    const errors = err.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    return res.status(400).json({
      success: false,
      error: 'Erro de validacao',
      details: errors,
    });
  }

  if (err instanceof ValidationError) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
      code: err.code,
      details: err.details,
    });
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
      code: err.code,
    });
  }

  // File system errors (permissions, disk full, etc.)
  const nodeErr = err as NodeJS.ErrnoException;
  if (nodeErr.code === 'EACCES' || nodeErr.code === 'EPERM') {
    return res.status(500).json({
      success: false,
      error: 'Erro de permissão no servidor — não foi possível salvar o arquivo',
    });
  }
  if (nodeErr.code === 'ENOENT') {
    return res.status(500).json({
      success: false,
      error: 'Diretório de uploads não encontrado no servidor',
    });
  }
  if (nodeErr.code === 'ENOSPC') {
    return res.status(500).json({
      success: false,
      error: 'Disco cheio no servidor',
    });
  }

  Sentry.captureException(err);
  return res.status(500).json({
    success: false,
    error: 'Erro interno do servidor',
  });
}
