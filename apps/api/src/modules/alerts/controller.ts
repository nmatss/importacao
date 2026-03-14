import type { Request, Response } from 'express';
import { alertService } from './service.js';
import { sendSuccess, sendError, sendPaginated } from '../../shared/utils/response.js';
import type { AuthenticatedRequest } from '../../shared/types/index.js';

export const alertController = {
  async list(req: Request, res: Response) {
    try {
      const { processId, severity, acknowledged, page: pageParam, limit: limitParam } = req.query;
      const page = Number(pageParam) || 1;
      const limit = Math.min(Number(limitParam) || 20, 100);
      const { data, total } = await alertService.list({
        processId: processId ? Number(processId) : undefined,
        severity: severity as string,
        acknowledged: acknowledged !== undefined ? acknowledged === 'true' : undefined,
        page,
        limit,
      });
      sendPaginated(res, data, total, page, limit);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async create(req: Request, res: Response) {
    try {
      const alert = await alertService.create(req.body);
      sendSuccess(res, alert, 201);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async acknowledge(req: Request, res: Response) {
    try {
      const userId = (req as AuthenticatedRequest).user.id;
      const alert = await alertService.acknowledge(Number(req.params.id), userId);
      sendSuccess(res, alert);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },
};
