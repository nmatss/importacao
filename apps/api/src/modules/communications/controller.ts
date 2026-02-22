import type { Request, Response } from 'express';
import { communicationService } from './service.js';
import { sendSuccess, sendError, sendPaginated } from '../../shared/utils/response.js';

export const communicationController = {
  async list(req: Request, res: Response) {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Math.min(Number(req.query.limit) || 20, 100);
      const processId = req.query.processId ? Number(req.query.processId) : undefined;
      const { data, total } = await communicationService.list(processId, page, limit);
      sendPaginated(res, data, total, page, limit);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async listByProcess(req: Request, res: Response) {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Math.min(Number(req.query.limit) || 20, 100);
      const { data, total } = await communicationService.list(Number(req.params.processId), page, limit);
      sendPaginated(res, data, total, page, limit);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async create(req: Request, res: Response) {
    try {
      const communication = await communicationService.create(req.body);
      sendSuccess(res, communication, 201);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async send(req: Request, res: Response) {
    try {
      const communication = await communicationService.send(Number(req.params.id));
      sendSuccess(res, communication);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },
};
