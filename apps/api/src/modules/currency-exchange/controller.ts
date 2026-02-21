import type { Request, Response } from 'express';
import { currencyExchangeService } from './service.js';
import { sendSuccess, sendError } from '../../shared/utils/response.js';

export const currencyExchangeController = {
  async list(req: Request, res: Response) {
    try {
      const processId = Number(req.params.processId);
      const data = await currencyExchangeService.list(processId);
      sendSuccess(res, data);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async getByProcess(req: Request, res: Response) {
    try {
      const processId = Number(req.params.processId);
      const data = await currencyExchangeService.getByProcess(processId);
      sendSuccess(res, data);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async create(req: Request, res: Response) {
    try {
      const exchange = await currencyExchangeService.create(req.body);
      sendSuccess(res, exchange, 201);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async update(req: Request, res: Response) {
    try {
      const exchange = await currencyExchangeService.update(Number(req.params.id), req.body);
      sendSuccess(res, exchange);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async delete(req: Request, res: Response) {
    try {
      await currencyExchangeService.delete(Number(req.params.id));
      sendSuccess(res, { message: 'Câmbio removido' });
    } catch (error: any) {
      sendError(res, error.message);
    }
  },
};
