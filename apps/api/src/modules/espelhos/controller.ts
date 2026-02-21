import type { Request, Response } from 'express';
import { espelhoService } from './service.js';
import { sendSuccess, sendError } from '../../shared/utils/response.js';

export const espelhoController = {
  async generate(req: Request, res: Response) {
    try {
      const espelho = await espelhoService.generate(Number(req.params.processId));
      sendSuccess(res, espelho, 201);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async getEspelho(req: Request, res: Response) {
    try {
      const espelho = await espelhoService.getEspelho(Number(req.params.processId));
      if (!espelho) {
        return sendError(res, 'Espelho nao encontrado para este processo', 404);
      }
      sendSuccess(res, espelho);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async getItems(req: Request, res: Response) {
    try {
      const items = await espelhoService.getItems(Number(req.params.processId));
      sendSuccess(res, items);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async updateItem(req: Request, res: Response) {
    try {
      const item = await espelhoService.updateItem(Number(req.params.id), req.body);
      sendSuccess(res, item);
    } catch (error: any) {
      sendError(res, error.message, error.message.includes('nao encontrado') ? 404 : 400);
    }
  },

  async addItem(req: Request, res: Response) {
    try {
      const item = await espelhoService.addItem(Number(req.params.processId), req.body);
      sendSuccess(res, item, 201);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async deleteItem(req: Request, res: Response) {
    try {
      await espelhoService.deleteItem(Number(req.params.id));
      sendSuccess(res, { message: 'Item removido' });
    } catch (error: any) {
      sendError(res, error.message, error.message.includes('nao encontrado') ? 404 : 400);
    }
  },

  async download(req: Request, res: Response) {
    try {
      const espelhoId = Number(req.params.id);
      const buffer = await espelhoService.downloadXlsx(espelhoId);

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader('Content-Disposition', `attachment; filename="espelho_${espelhoId}.xlsx"`);
      res.send(buffer);
    } catch (error: any) {
      sendError(res, error.message, error.message.includes('nao encontrado') ? 404 : 400);
    }
  },

  async markSentToFenicia(req: Request, res: Response) {
    try {
      const espelho = await espelhoService.markSentToFenicia(Number(req.params.id));
      sendSuccess(res, espelho);
    } catch (error: any) {
      sendError(res, error.message, error.message.includes('nao encontrado') ? 404 : 400);
    }
  },

  async generatePartial(req: Request, res: Response) {
    try {
      const espelho = await espelhoService.generatePartial(Number(req.params.processId));
      sendSuccess(res, espelho, 201);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },
};
