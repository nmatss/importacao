import type { Request, Response } from 'express';
import { communicationService } from './service.js';
import { sendSuccess, sendError, sendPaginated } from '../../shared/utils/response.js';

export const communicationController = {
  async list(req: Request, res: Response) {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Math.min(Number(req.query.limit) || 20, 100);
      const processId = req.query.processId ? Number(req.query.processId) : undefined;
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;
      const { data, total } = await communicationService.list(
        processId,
        page,
        limit,
        startDate,
        endDate,
      );
      sendPaginated(res, data, total, page, limit);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async listByProcess(req: Request, res: Response) {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Math.min(Number(req.query.limit) || 20, 100);
      const { data, total } = await communicationService.list(
        Number(req.params.processId),
        page,
        limit,
      );
      sendPaginated(res, data, total, page, limit);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async create(req: Request, res: Response) {
    try {
      const communication = await communicationService.create(req.body);
      sendSuccess(res, communication, 201);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async send(req: Request, res: Response) {
    try {
      const signatureId = req.body?.signatureId ? Number(req.body.signatureId) : undefined;
      const communication = await communicationService.send(Number(req.params.id), signatureId);
      sendSuccess(res, communication);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async updateDraft(req: Request, res: Response) {
    try {
      const id = Number(req.params.id);
      if (isNaN(id) || id <= 0) {
        return sendError(res, 'ID da comunicacao invalido', 400);
      }
      const communication = await communicationService.updateDraft(id, req.body);
      sendSuccess(res, communication);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },
};
