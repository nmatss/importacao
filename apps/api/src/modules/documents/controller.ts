import type { Request, Response } from 'express';
import { documentService } from './service.js';
import { sendSuccess, sendError } from '../../shared/utils/response.js';
import {
  acceptComparisonSchema,
  editComparisonFieldSchema,
  uploadDocumentSchema,
} from './schema.js';

export function isActiveContent(mimeType: string, filename?: string | null): boolean {
  const lowerMime = mimeType.toLowerCase();
  const lowerName = filename?.toLowerCase() ?? '';

  return (
    lowerMime === 'text/html' ||
    lowerMime === 'application/xhtml+xml' ||
    lowerName.endsWith('.html') ||
    lowerName.endsWith('.htm')
  );
}

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
      const { processId, documentType } = parsed.data;
      const userId = req.user?.id ?? null;
      const doc = await documentService.upload(processId, documentType, req.file, userId);
      sendSuccess(res, doc, 201);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async getByProcess(req: Request, res: Response) {
    try {
      const docs = await documentService.getByProcess(Number(req.params.processId));
      sendSuccess(res, docs);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async getById(req: Request, res: Response) {
    try {
      const doc = await documentService.getById(Number(req.params.id));
      sendSuccess(res, doc);
    } catch (error: any) {
      const status = error.statusCode || 404;
      sendError(res, error.message, status);
    }
  },

  async getSource(req: Request, res: Response) {
    try {
      const source = await documentService.getSource(Number(req.params.id));
      sendSuccess(res, source);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async getExtractionHistory(req: Request, res: Response) {
    try {
      const documentId = Number(req.params.id);
      if (isNaN(documentId) || documentId <= 0) {
        return sendError(res, 'ID do documento invalido', 400);
      }
      const history = await documentService.getExtractionHistory(documentId);
      sendSuccess(res, history);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async getExtractionHistoryByProcess(req: Request, res: Response) {
    try {
      const processId = Number(req.params.processId);
      if (isNaN(processId) || processId <= 0) {
        return sendError(res, 'ID do processo invalido', 400);
      }
      const history = await documentService.getExtractionHistoryByProcess(processId);
      sendSuccess(res, history);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async getFile(req: Request, res: Response) {
    try {
      const resource = await documentService.getFileResource(Number(req.params.id));
      const wantsDownload = req.query.download === '1' || req.query.download === 'true';

      if (resource.kind === 'drive') {
        // Redirect to Google Drive — falls back when local file is missing
        const viewerUrl = `https://drive.google.com/file/d/${resource.driveFileId}/view`;
        return res.redirect(302, viewerUrl);
      }

      const safeName = encodeURIComponent(resource.filename ?? `documento-${req.params.id}`);
      const forceAttachment = isActiveContent(resource.mimeType, resource.filename);
      const contentType = forceAttachment ? 'application/octet-stream' : resource.mimeType;
      const disposition = wantsDownload || forceAttachment ? 'attachment' : 'inline';

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${safeName}`);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.sendFile(resource.absolutePath);
    } catch (error: any) {
      const status = error.statusCode || 404;
      sendError(res, error.message, status);
    }
  },

  async reprocess(req: Request, res: Response) {
    try {
      const userId = req.user?.id ?? null;
      const doc = await documentService.reprocess(Number(req.params.id), userId);
      sendSuccess(res, doc);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async delete(req: Request, res: Response) {
    try {
      const userId = req.user?.id ?? null;
      await documentService.delete(Number(req.params.id), userId);
      sendSuccess(res, { message: 'Documento removido' });
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async reconcileProcess(req: Request, res: Response) {
    try {
      const results = await documentService.reconcileProcess(Number(req.params.processId));
      sendSuccess(res, { processId: Number(req.params.processId), results });
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async reconcileAll(_req: Request, res: Response) {
    try {
      const summary = await documentService.reconcileAllProcesses();
      sendSuccess(res, summary);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async comparison(req: Request, res: Response) {
    try {
      const result = await documentService.getComparison(Number(req.params.processId));
      sendSuccess(res, result);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async acceptComparison(req: Request, res: Response) {
    try {
      const parsed = acceptComparisonSchema.safeParse(req.body);
      if (!parsed.success) {
        const errors = parsed.error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        return sendError(res, JSON.stringify(errors), 400);
      }
      const userId = req.user?.id ?? null;
      const result = await documentService.acceptComparison(
        Number(req.params.processId),
        parsed.data,
        userId,
      );
      sendSuccess(res, result);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async editComparisonField(req: Request, res: Response) {
    try {
      const parsed = editComparisonFieldSchema.safeParse(req.body);
      if (!parsed.success) {
        const errors = parsed.error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        return sendError(res, JSON.stringify(errors), 400);
      }
      const result = await documentService.editComparisonField(
        Number(req.params.processId),
        parsed.data,
        req.user?.id ?? null,
      );
      sendSuccess(res, result);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async proformasAggregate(req: Request, res: Response) {
    try {
      const result = await documentService.getProformasAggregate(Number(req.params.processId));
      sendSuccess(res, result);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },
};
