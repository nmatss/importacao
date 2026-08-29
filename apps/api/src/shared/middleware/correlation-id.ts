import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';
import { requestContext } from '../observability/context.js';
import type { Logger } from 'pino';

declare global {
  namespace Express {
    interface Request {
      correlationId: string;
      log: Logger;
    }
  }
}

/**
 * Formato aceito para um `x-correlation-id` vindo do cliente.
 *
 * O valor era aceito CRU: ia para todas as linhas de log da requisicao e voltava
 * no header da resposta. Duas consequencias — um valor longo polui o log inteiro
 * de uma requisicao, e um valor com quebra de linha faz `res.setHeader` lancar
 * `ERR_INVALID_CHAR`, transformando um header malformado em erro 500.
 *
 * Correlacao e conveniencia de diagnostico, nao dado de negocio: quando o valor
 * nao serve, gerar um proprio e melhor que confiar ou que falhar.
 */
const CORRELATION_ID_PATTERN = /^[\w-]{1,64}$/;

export function correlationId(req: Request, res: Response, next: NextFunction): void {
  const provided = req.headers['x-correlation-id'];
  const candidate = typeof provided === 'string' ? provided : '';
  const id = CORRELATION_ID_PATTERN.test(candidate) ? candidate : crypto.randomUUID();
  req.correlationId = id;
  req.log = logger.child({ correlationId: id });
  res.setHeader('x-correlation-id', id);
  requestContext.run({ requestId: id }, next);
}
