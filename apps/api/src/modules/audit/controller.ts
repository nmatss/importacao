import type { Request, Response } from 'express';
import { auditService } from './service.js';
import { sendPaginated, sendError } from '../../shared/utils/response.js';

export const auditController = {
  async getLogs(req: Request, res: Response) {
    try {
      const {
        page = '1',
        limit = '20',
        action,
        entityType,
        entityId,
        userId,
        startDate,
        endDate,
      } = req.query;

      const result = await auditService.getLogs({
        page: Math.max(1, Number(page)),
        limit: Math.min(100, Math.max(1, Number(limit))),
        action: action as string | undefined,
        entityType: entityType as string | undefined,
        entityId: entityId ? Number(entityId) : undefined,
        userId: userId ? Number(userId) : undefined,
        startDate: startDate as string | undefined,
        endDate: endDate as string | undefined,
      });

      sendPaginated(res, result.data, result.total, result.page, result.limit);
    } catch (error: any) {
      sendError(res, error.message, 500);
    }
  },
};
