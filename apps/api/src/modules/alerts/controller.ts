import type { Request, Response } from 'express';
import { alertService } from './service.js';
import { sendSuccess, sendError } from '../../shared/utils/response.js';
import type { AuthenticatedRequest } from '../../shared/types/index.js';

export const alertController = {
  async list(req: Request, res: Response) {
    try {
      const { processId, severity, acknowledged } = req.query;
      const alertsList = await alertService.list({
        processId: processId ? Number(processId) : undefined,
        severity: severity as string,
        acknowledged: acknowledged !== undefined ? acknowledged === 'true' : undefined,
      });
      sendSuccess(res, alertsList);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async create(req: Request, res: Response) {
    try {
      const alert = await alertService.create(req.body);
      sendSuccess(res, alert, 201);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async acknowledge(req: Request, res: Response) {
    try {
      const userId = (req as AuthenticatedRequest).user.id;
      const alert = await alertService.acknowledge(Number(req.params.id), userId);
      sendSuccess(res, alert);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },
};
