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
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async getLogs(req: Request, res: Response) {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;
      const result = await emailProcessor.getLogs(page, limit, startDate, endDate);
      sendPaginated(res, result.data, result.total, result.page, result.limit);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async triggerCheck(req: Request, res: Response) {
    try {
      const includeRead = req.query.includeRead === 'true';
      const dateRe = /^\d{4}\/\d{2}\/\d{2}$/;
      const after =
        typeof req.query.after === 'string' && dateRe.test(req.query.after)
          ? req.query.after
          : undefined;
      const before =
        typeof req.query.before === 'string' && dateRe.test(req.query.before)
          ? req.query.before
          : undefined;
      const rawQuery =
        typeof req.query.q === 'string' ? req.query.q.replace(/[{}()|&;$`]/g, '') : undefined;
      const skipSenderFilter = req.query.allSenders === 'true';
      let gmailQuery: string | undefined;
      if (rawQuery) {
        gmailQuery = rawQuery;
      } else if (after || before) {
        const parts = ['has:attachment'];
        if (after) parts.push(`after:${after}`);
        if (before) parts.push(`before:${before}`);
        if (!skipSenderFilter) {
          const allowedSenders =
            process.env.EMAIL_ALLOWED_SENDERS?.split(',')
              .map((s) => s.trim())
              .filter(Boolean) || [];
          if (allowedSenders.length > 0) {
            parts.push(`{${allowedSenders.map((s) => `from:${s}`).join(' ')}}`);
          }
        }
        gmailQuery = parts.join(' ');
      }
      await emailProcessor.processNewEmails(includeRead, gmailQuery);
      sendSuccess(res, { message: 'Verificação de emails concluída' });
    } catch (error: any) {
      logger.error({ error }, 'Manual email check failed');
      const status = error.statusCode || 400;
      sendError(res, `Falha na verificação: ${error.message}`, status);
    }
  },

  async historyScan(req: Request, res: Response) {
    try {
      const months = Math.min(Number(req.query.months) || 6, 12);
      const daysBack = months * 30;

      logger.info({ months, daysBack }, 'Starting historical email scan');

      const parts = ['has:attachment', `newer_than:${daysBack}d`];

      const skipSenderFilter = req.query.allSenders === 'true';
      if (!skipSenderFilter) {
        const allowedSenders =
          process.env.EMAIL_ALLOWED_SENDERS?.split(',')
            .map((s: string) => s.trim())
            .filter(Boolean) || [];
        if (allowedSenders.length > 0) {
          parts.push(`{${allowedSenders.map((s: string) => `from:${s}`).join(' ')}}`);
        }
      }

      const gmailQuery = parts.join(' ');

      // Process with includeRead=true to catch all historical emails
      await emailProcessor.processNewEmails(true, gmailQuery);
      sendSuccess(res, {
        message: `Varredura histórica de ${months} meses concluída`,
        query: gmailQuery,
      });
    } catch (error: any) {
      logger.error({ error }, 'Historical email scan failed');
      const status = error.statusCode || 400;
      sendError(res, `Falha na varredura histórica: ${error.message}`, status);
    }
  },

  async reprocess(req: Request, res: Response) {
    try {
      const result = await emailProcessor.reprocess(Number(req.params.logId));
      sendSuccess(res, result);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },
};
