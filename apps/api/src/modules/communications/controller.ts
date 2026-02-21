import type { Request, Response } from 'express';
import { communicationService } from './service.js';
import { sendSuccess, sendError } from '../../shared/utils/response.js';

export const communicationController = {
  async list(_req: Request, res: Response) {
    try {
      const data = await communicationService.list();
      sendSuccess(res, data);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async listByProcess(req: Request, res: Response) {
    try {
      const data = await communicationService.list(Number(req.params.processId));
      sendSuccess(res, data);
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
