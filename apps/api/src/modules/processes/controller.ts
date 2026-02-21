import type { Request, Response } from 'express';
import { processService } from './service.js';
import { sendSuccess, sendError, sendPaginated } from '../../shared/utils/response.js';
import type { AuthenticatedRequest } from '../../shared/types/index.js';

export const processController = {
  async list(req: Request, res: Response) {
    try {
      const { data, total, page, limit } = await processService.list(req.query as any);
      sendPaginated(res, data, total, page, limit);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async getById(req: Request, res: Response) {
    try {
      const process = await processService.getById(Number(req.params.id));
      sendSuccess(res, process);
    } catch (error: any) {
      sendError(res, error.message, 404);
    }
  },

  async create(req: Request, res: Response) {
    try {
      const userId = (req as AuthenticatedRequest).user.id;
      const process = await processService.create(req.body, userId);
      sendSuccess(res, process, 201);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async update(req: Request, res: Response) {
    try {
      const process = await processService.update(Number(req.params.id), req.body);
      sendSuccess(res, process);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async updateStatus(req: Request, res: Response) {
    try {
      const { status } = req.body;
      const process = await processService.updateStatus(Number(req.params.id), status);
      sendSuccess(res, process);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async delete(req: Request, res: Response) {
    try {
      await processService.delete(Number(req.params.id));
      sendSuccess(res, { message: 'Processo cancelado' });
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async getStats(_req: Request, res: Response) {
    try {
      const stats = await processService.getStats();
      sendSuccess(res, stats);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },
};
