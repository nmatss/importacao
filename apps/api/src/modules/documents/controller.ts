import type { Request, Response } from 'express';
import { documentService } from './service.js';
import { sendSuccess, sendError } from '../../shared/utils/response.js';
import { uploadDocumentSchema } from './schema.js';

export const documentController = {
  async upload(req: Request, res: Response) {
    try {
      if (!req.file) {
        return sendError(res, 'Nenhum arquivo enviado', 400);
      }
      const parsed = uploadDocumentSchema.safeParse(req.body);
      if (!parsed.success) {
        const errors = parsed.error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        return sendError(res, JSON.stringify(errors), 400);
      }
      const { processId, type } = parsed.data;
      const userId = req.user?.id ?? null;
      const doc = await documentService.upload(processId, type, req.file, userId);
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
      const userId = req.user?.id ?? null;
      const doc = await documentService.reprocess(Number(req.params.id), userId);
      sendSuccess(res, doc);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async delete(req: Request, res: Response) {
    try {
      const userId = req.user?.id ?? null;
      await documentService.delete(Number(req.params.id), userId);
      sendSuccess(res, { message: 'Documento removido' });
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async comparison(req: Request, res: Response) {
    try {
      const result = await documentService.getComparison(Number(req.params.processId));
      sendSuccess(res, result);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },
};
