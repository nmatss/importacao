import type { Request, Response } from 'express';
import { settingsService } from './service.js';
import { sendSuccess, sendError } from '../../shared/utils/response.js';

export const settingsController = {
  async getAll(_req: Request, res: Response) {
    try {
      const settings = await settingsService.getAll();
      sendSuccess(res, settings);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async get(req: Request, res: Response) {
    try {
      const setting = await settingsService.get(req.params.key);
      if (!setting) return sendError(res, 'Configuração não encontrada', 404);
      sendSuccess(res, setting);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async set(req: Request, res: Response) {
    try {
      const { value, description } = req.body;
      const setting = await settingsService.set(req.params.key, value, description);
      sendSuccess(res, setting);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },
};
