import type { Request, Response } from 'express';
import { assistantService } from './service.js';
import { sendError, sendSuccess } from '../../shared/utils/response.js';
import type { AuthenticatedRequest } from '../../shared/types/index.js';
import { logger } from '../../shared/utils/logger.js';

export const assistantController = {
  async query(req: Request, res: Response) {
    try {
      const authReq = req as AuthenticatedRequest;
      const result = await assistantService.query(req.body, authReq.user);
      return sendSuccess(res, result);
    } catch (error: any) {
      logger.error({ error }, 'Operational assistant query failed');
      const status = error.statusCode || 400;
      return sendError(res, error.message || 'Erro ao consultar o assistente', status);
    }
  },
};
