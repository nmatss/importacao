import type { Request, Response } from 'express';
import { financialService } from './service.js';
import { sendSuccess, sendError } from '../../shared/utils/response.js';

export const financialController = {
  async getFinancials(req: Request, res: Response) {
    try {
      const snapshot = await financialService.getSnapshot(Number(req.params.id));
      sendSuccess(res, snapshot);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async recompute(req: Request, res: Response) {
    try {
      const userId = req.user?.id ?? null;
      const result = await financialService.recompute(Number(req.params.id), userId);
      sendSuccess(res, result);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },
};
