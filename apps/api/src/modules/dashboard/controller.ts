import type { Request, Response } from 'express';
import { dashboardService } from './service.js';
import { executiveService } from './executive.service.js';
import { sendSuccess, sendError } from '../../shared/utils/response.js';

export const dashboardController = {
  async getExecutiveKpis(_req: Request, res: Response) {
    try {
      const data = await executiveService.getExecutiveKpis();
      sendSuccess(res, data);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async getProcessingTimeline(_req: Request, res: Response) {
    try {
      const data = await executiveService.getProcessingTimeline();
      sendSuccess(res, data);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async getOverview(_req: Request, res: Response) {
    try {
      const overview = await dashboardService.getOverview();
      sendSuccess(res, overview);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async getByStatus(_req: Request, res: Response) {
    try {
      const data = await dashboardService.getByStatus();
      sendSuccess(res, data);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async getByMonth(_req: Request, res: Response) {
    try {
      const data = await dashboardService.getByMonth();
      sendSuccess(res, data);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async getFobByBrand(_req: Request, res: Response) {
    try {
      const data = await dashboardService.getFobByBrand();
      sendSuccess(res, data);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async getSla(_req: Request, res: Response) {
    try {
      const data = await dashboardService.getSla();
      sendSuccess(res, data);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },
};
