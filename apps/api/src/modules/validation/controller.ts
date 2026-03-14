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

  async resolveManually(req: Request, res: Response) {
    try {
      const resultId = Number(req.params.id);
      if (isNaN(resultId) || resultId <= 0) {
        return sendError(res, 'ID do resultado invalido', 400);
      }
      const userId = (req as AuthenticatedRequest).user.id;
      const result = await validationService.resolveManually(resultId, userId);
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
