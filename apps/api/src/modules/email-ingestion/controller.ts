import type { Request, Response } from 'express';
import { emailProcessor } from './processor.js';
import { sendSuccess, sendError, sendPaginated } from '../../shared/utils/response.js';
import { logger } from '../../shared/utils/logger.js';

function allowedSenderFilter(): string | null {
  const allowedSenders =
    process.env.EMAIL_ALLOWED_SENDERS?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) || [];
  if (allowedSenders.length === 0) return null;
  return `{${allowedSenders.map((s) => `from:${s}`).join(' ')}}`;
}

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
      const processId = req.query.processId ? Number(req.query.processId) : undefined;
      const processCode = req.query.processCode as string | undefined;
      const status = req.query.status as string | undefined;
      const result = await emailProcessor.getLogs(page, limit, startDate, endDate, {
        processId,
        processCode,
        status,
      });
      sendPaginated(res, result.data, result.total, result.page, result.limit);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async triggerCheck(req: Request, res: Response) {
    try {
      const includeRead = (req.query.includeRead as unknown) === true;
      const after = typeof req.query.after === 'string' ? req.query.after : undefined;
      const before = typeof req.query.before === 'string' ? req.query.before : undefined;
      const rawQuery = typeof req.query.q === 'string' ? req.query.q : undefined;
      const senderFilter = allowedSenderFilter();
      if (!senderFilter) {
        return sendError(
          res,
          'EMAIL_ALLOWED_SENDERS deve estar configurado para varredura de e-mails',
          400,
        );
      }
      let gmailQuery: string | undefined;
      if (rawQuery) {
        gmailQuery = `${rawQuery} ${senderFilter}`;
      } else if (after || before) {
        const parts = ['has:attachment', senderFilter];
        if (after) parts.push(`after:${after}`);
        if (before) parts.push(`before:${before}`);
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
      const senderFilter = allowedSenderFilter();
      if (!senderFilter) {
        return sendError(
          res,
          'EMAIL_ALLOWED_SENDERS deve estar configurado para varredura historica',
          400,
        );
      }
      parts.push(senderFilter);

      const gmailQuery = parts.join(' ');

      // Process with includeRead=true to catch all historical emails
      const summary = await emailProcessor.processNewEmails(true, gmailQuery);
      // The assembled query embeds every allowed sender address; report the
      // shape of the scan instead of echoing the allow-list back to the client.
      sendSuccess(res, {
        message: `Varredura histórica de ${months} meses concluída`,
        months,
        fetched: summary.fetched,
        processed: summary.processed,
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
