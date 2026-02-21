import type { Request, Response } from 'express';
import { followUpService } from './service.js';
import { sendSuccess, sendError } from '../../shared/utils/response.js';

export const followUpController = {
  async getAll(_req: Request, res: Response) {
    try {
      const data = await followUpService.getAll();
      sendSuccess(res, data);
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
};
