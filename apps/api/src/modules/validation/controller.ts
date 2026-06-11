import type { Request, Response } from 'express';
import { validationService } from './service.js';
import { communicationService } from '../communications/service.js';
import { sendSuccess, sendError } from '../../shared/utils/response.js';
import type { AuthenticatedRequest } from '../../shared/types/index.js';

export const validationController = {
  async runAllChecks(req: Request, res: Response) {
    try {
      const processId = Number(req.params.processId);
      if (isNaN(processId) || processId <= 0) {
        return sendError(res, 'ID do processo invalido', 400);
      }
      const userId = (req as AuthenticatedRequest).user?.id ?? null;
      const results = await validationService.runAllChecks(processId, userId);
      sendSuccess(res, results);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async getResults(req: Request, res: Response) {
    try {
      const processId = Number(req.params.processId);
      if (isNaN(processId) || processId <= 0) {
        return sendError(res, 'ID do processo invalido', 400);
      }
      const results = await validationService.getResults(processId);
      sendSuccess(res, results);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async getValidationHistory(req: Request, res: Response) {
    try {
      // Mounted under /processes/:id/validation-history (and accepts
      // :processId when reused under /validation routes).
      const processId = Number(req.params.id ?? req.params.processId);
      if (isNaN(processId) || processId <= 0) {
        return sendError(res, 'ID do processo invalido', 400);
      }
      const page = Number(req.query.page) || 1;
      const pageSize = Number(req.query.pageSize) || 10;
      const history = await validationService.getValidationHistory(processId, page, pageSize);
      sendSuccess(res, history);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async resolveManually(req: Request, res: Response) {
    try {
      const resultId = Number(req.params.id);
      if (isNaN(resultId) || resultId <= 0) {
        return sendError(res, 'ID do resultado invalido', 400);
      }
      // Aceita camelCase (resolutionNote) e snake_case (resolution_note, o que o
      // front envia). NÃO usa req.body.resolution como nota — esse campo carrega
      // só a AÇÃO ('manual'), não a justificativa; aceitá-lo furaria a obrigação.
      const rawNote =
        typeof req.body?.resolutionNote === 'string'
          ? req.body.resolutionNote
          : typeof req.body?.resolution_note === 'string'
            ? req.body.resolution_note
            : '';
      const resolutionNote = rawNote.trim();
      if (!resolutionNote) {
        return sendError(res, 'Justificativa (resolutionNote) e obrigatoria', 400);
      }
      const userId = (req as AuthenticatedRequest).user.id;
      const result = await validationService.resolveManually(resultId, userId, resolutionNote);
      sendSuccess(res, result);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async getReport(req: Request, res: Response) {
    try {
      const processId = Number(req.params.processId);
      if (isNaN(processId) || processId <= 0) {
        return sendError(res, 'ID do processo invalido', 400);
      }
      const report = await validationService.getReport(processId);
      sendSuccess(res, report);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async runAnomalyDetection(req: Request, res: Response) {
    try {
      const processId = Number(req.params.processId);
      if (isNaN(processId) || processId <= 0) {
        return sendError(res, 'ID do processo invalido', 400);
      }
      const anomalies = await validationService.runAnomalyDetection(processId);
      sendSuccess(res, anomalies);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async getCorrections(req: Request, res: Response) {
    try {
      const processId = Number(req.params.processId);
      if (isNaN(processId) || processId <= 0) {
        return sendError(res, 'ID do processo invalido', 400);
      }
      const correction = await validationService.getCorrections(processId);
      sendSuccess(res, correction);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async updateCorrection(req: Request, res: Response) {
    try {
      const processId = Number(req.params.processId);
      if (isNaN(processId) || processId <= 0) {
        return sendError(res, 'ID do processo invalido', 400);
      }
      const { correctionReceivedAt, notes } = req.body;
      const updated = await validationService.updateCorrection(processId, {
        correctionReceivedAt: correctionReceivedAt ? new Date(correctionReceivedAt) : undefined,
        notes,
      });
      sendSuccess(res, updated);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async generateCorrectionDraft(req: Request, res: Response) {
    try {
      const processId = Number(req.params.processId);
      if (isNaN(processId) || processId <= 0) {
        return sendError(res, 'ID do processo invalido', 400);
      }
      const useAi = req.body?.useAi === true;
      const draft = await communicationService.generateCorrectionDraft(processId, useAi);
      sendSuccess(res, draft, 201);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },
};
