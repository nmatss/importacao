import type { Request, Response } from 'express';
import { followUpService } from './service.js';
import { sendSuccess, sendError, sendPaginated } from '../../shared/utils/response.js';

export const followUpController = {
  async getAll(req: Request, res: Response) {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Math.min(Number(req.query.limit) || 20, 100);
      const { data, total } = await followUpService.getAll(page, limit);
      sendPaginated(res, data, total, page, limit);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async getByProcess(req: Request, res: Response) {
    try {
      const tracking = await followUpService.getByProcess(Number(req.params.processId));
      sendSuccess(res, tracking);
    } catch (error: any) {
      sendError(res, error.message, 404);
    }
  },

  async update(req: Request, res: Response) {
    try {
      const tracking = await followUpService.update(Number(req.params.processId), req.body);
      sendSuccess(res, tracking);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async getLiDeadlines(_req: Request, res: Response) {
    try {
      const deadlines = await followUpService.getLiDeadlines();
      sendSuccess(res, deadlines);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async compareWithSheet(req: Request, res: Response) {
    try {
      const { processCode } = req.params;
      const result = await followUpService.compareWithSheet(processCode);
      sendSuccess(res, result);
    } catch (error: any) {
      sendError(res, error.message, 404);
    }
  },

  async syncFromSheet(req: Request, res: Response) {
    try {
      const { processCode } = req.params;
      const mode = (req.body?.mode || 'conservative') as 'conservative' | 'industrial';
      const result = await followUpService.syncFromSheet(processCode, mode);
      sendSuccess(res, result);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },
};
