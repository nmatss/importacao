import type { Request, Response } from 'express';
import { validationService } from './service.js';
import { sendSuccess, sendError } from '../../shared/utils/response.js';
import type { AuthenticatedRequest } from '../../shared/types/index.js';

export const validationController = {
  async runAllChecks(req: Request, res: Response) {
    try {
      const processId = Number(req.params.processId);
      const results = await validationService.runAllChecks(processId);
      sendSuccess(res, results);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async getResults(req: Request, res: Response) {
    try {
      const processId = Number(req.params.processId);
      const results = await validationService.getResults(processId);
      sendSuccess(res, results);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async resolveManually(req: Request, res: Response) {
    try {
      const resultId = Number(req.params.id);
      const userId = (req as AuthenticatedRequest).user.id;
      const result = await validationService.resolveManually(resultId, userId);
      sendSuccess(res, result);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async runAnomalyDetection(req: Request, res: Response) {
    try {
      const processId = Number(req.params.processId);
      const anomalies = await validationService.runAnomalyDetection(processId);
      sendSuccess(res, anomalies);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },
};
