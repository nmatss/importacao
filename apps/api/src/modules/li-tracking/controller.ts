import type { Request, Response } from 'express';
import { liTrackingService } from './service.js';
import { sendSuccess, sendError, sendPaginated } from '../../shared/utils/response.js';

export const liTrackingController = {
  async getAll(req: Request, res: Response) {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Math.min(Number(req.query.limit) || 20, 100);
      const filters = {
        processCode: req.query.processCode as string | undefined,
        status: req.query.status as string | undefined,
        orgao: req.query.orgao as string | undefined,
        startDate: req.query.startDate as string | undefined,
        endDate: req.query.endDate as string | undefined,
      };
      const { data, total } = await liTrackingService.getAll(page, limit, filters);
      sendPaginated(res, data, total, page, limit);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async getStats(_req: Request, res: Response) {
    try {
      const stats = await liTrackingService.getStats();
      sendSuccess(res, stats);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async getByProcess(req: Request, res: Response) {
    try {
      const { processCode } = req.params;
      const data = await liTrackingService.getByProcess(processCode);
      sendSuccess(res, data);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async create(req: Request, res: Response) {
    try {
      const entry = await liTrackingService.create(req.body);
      sendSuccess(res, entry, 201);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async update(req: Request, res: Response) {
    try {
      const entry = await liTrackingService.update(Number(req.params.id), req.body);
      sendSuccess(res, entry);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async delete(req: Request, res: Response) {
    try {
      await liTrackingService.delete(Number(req.params.id));
      sendSuccess(res, { message: 'LI tracking entry removed' });
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },
};
