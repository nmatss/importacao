import type { Request, Response } from 'express';
import { documentService } from './service.js';
import { sendSuccess, sendError } from '../../shared/utils/response.js';

export const documentController = {
  async upload(req: Request, res: Response) {
    try {
      if (!req.file) {
        return sendError(res, 'Nenhum arquivo enviado', 400);
      }
      const { processId, type } = req.body;
      const doc = await documentService.upload(Number(processId), type, req.file);
      sendSuccess(res, doc, 201);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async getByProcess(req: Request, res: Response) {
    try {
      const docs = await documentService.getByProcess(Number(req.params.processId));
      sendSuccess(res, docs);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async getById(req: Request, res: Response) {
    try {
      const doc = await documentService.getById(Number(req.params.id));
      sendSuccess(res, doc);
    } catch (error: any) {
      sendError(res, error.message, 404);
    }
  },

  async getSource(req: Request, res: Response) {
    try {
      const source = await documentService.getSource(Number(req.params.id));
      sendSuccess(res, source);
    } catch (error: any) {
      sendError(res, error.message, error.message.includes('não encontrado') ? 404 : 400);
    }
  },

  async reprocess(req: Request, res: Response) {
    try {
      const doc = await documentService.reprocess(Number(req.params.id));
      sendSuccess(res, doc);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async delete(req: Request, res: Response) {
    try {
      await documentService.delete(Number(req.params.id));
      sendSuccess(res, { message: 'Documento removido' });
    } catch (error: any) {
      sendError(res, error.message);
    }
  },
};
