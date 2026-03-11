import type { Request, Response } from 'express';
import { emailProcessor } from './processor.js';
import { sendSuccess, sendError, sendPaginated } from '../../shared/utils/response.js';
import { logger } from '../../shared/utils/logger.js';

export const emailIngestionController = {
  async getStatus(_req: Request, res: Response) {
    try {
      const status = await emailProcessor.getStatus();
      sendSuccess(res, status);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async getLogs(req: Request, res: Response) {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const result = await emailProcessor.getLogs(page, limit);
      sendPaginated(res, result.data, result.total, result.page, result.limit);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async triggerCheck(req: Request, res: Response) {
    try {
      const includeRead = req.query.includeRead === 'true';
      const after = req.query.after as string | undefined; // e.g. 2025/02/01
      const before = req.query.before as string | undefined; // e.g. 2025/03/12
      const rawQuery = req.query.q as string | undefined; // raw Gmail query override
      const skipSenderFilter = req.query.allSenders === 'true';
      let gmailQuery: string | undefined;
      if (rawQuery) {
        gmailQuery = rawQuery;
      } else if (after || before) {
        const parts = ['has:attachment'];
        if (after) parts.push(`after:${after}`);
        if (before) parts.push(`before:${before}`);
        if (!skipSenderFilter) {
          const allowedSenders = process.env.EMAIL_ALLOWED_SENDERS
            ?.split(',').map(s => s.trim()).filter(Boolean) || [];
          if (allowedSenders.length > 0) {
            parts.push(`{${allowedSenders.map(s => `from:${s}`).join(' ')}}`);
          }
        }
        gmailQuery = parts.join(' ');
      }
      await emailProcessor.processNewEmails(includeRead, gmailQuery);
      sendSuccess(res, { message: 'Verificação de emails concluída' });
    } catch (error: any) {
      logger.error({ error }, 'Manual email check failed');
      sendError(res, `Falha na verificação: ${error.message}`);
    }
  },

  async reprocess(req: Request, res: Response) {
    try {
      const result = await emailProcessor.reprocess(Number(req.params.logId));
      sendSuccess(res, result);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },
};
