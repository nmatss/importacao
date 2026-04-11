import type { Request, Response } from 'express';
import { processService } from './service.js';
import { sendSuccess, sendError, sendPaginated } from '../../shared/utils/response.js';
import type { AuthenticatedRequest } from '../../shared/types/index.js';
import type { ProcessFilter } from './schema.js';

export const processController = {
  async list(req: Request, res: Response) {
    try {
      const { data, total, page, limit } = await processService.list(
        req.query as unknown as ProcessFilter,
      );
      sendPaginated(res, data, total, page, limit);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async getById(req: Request, res: Response) {
    try {
      const process = await processService.getById(Number(req.params.id));
      sendSuccess(res, process);
    } catch (error: any) {
      const status = error.statusCode || 404;
      sendError(res, error.message, status);
    }
  },

  async create(req: Request, res: Response) {
    try {
      const userId = (req as AuthenticatedRequest).user.id;
      const process = await processService.create(req.body, userId);
      sendSuccess(res, process, 201);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async createFromPreCons(req: Request, res: Response) {
    try {
      const userId = (req as AuthenticatedRequest).user.id;
      const result = await processService.createFromPreCons(req.body, userId);
      if (result.created) {
        sendSuccess(res, result.process, 201);
      } else {
        sendSuccess(res, { ...result.process, existed: true }, 200);
      }
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async update(req: Request, res: Response) {
    try {
      const userId = req.user?.id ?? null;
      const process = await processService.update(Number(req.params.id), req.body, userId);
      sendSuccess(res, process);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async updateStatus(req: Request, res: Response) {
    try {
      const userId = req.user?.id ?? null;
      const { status } = req.body;
      const process = await processService.updateStatus(Number(req.params.id), status, userId);
      sendSuccess(res, process);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async updateLogisticStatus(req: Request, res: Response) {
    try {
      const userId = req.user?.id ?? null;
      const { logisticStatus } = req.body;
      const process = await processService.updateLogisticStatus(
        Number(req.params.id),
        logisticStatus,
        userId,
      );
      sendSuccess(res, process);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async delete(req: Request, res: Response) {
    try {
      const userId = req.user?.id ?? null;
      await processService.delete(Number(req.params.id), userId);
      sendSuccess(res, { message: 'Processo cancelado' });
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async getEvents(req: Request, res: Response) {
    try {
      const limit = Number(req.query.limit) || 50;
      const events = await processService.getEvents(Number(req.params.id), limit);
      sendSuccess(res, events);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async getStats(_req: Request, res: Response) {
    try {
      const stats = await processService.getStats();
      sendSuccess(res, stats);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },
};
