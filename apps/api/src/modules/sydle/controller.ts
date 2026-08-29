import type { Request, Response } from 'express';
import { sendError, sendPaginated, sendSuccess } from '../../shared/utils/response.js';
import { sydleService } from './service.js';
import { sydleReportQuerySchema, syncRunsQuerySchema } from './schema.js';
// O nome do arquivo exportado carrega a data do operador, nao a do container:
// `toISOString()` e UTC e, das 21h a meia-noite, nomeava o arquivo com o dia seguinte.
import { localTodayIso } from '../../shared/utils/dates.js';

function booleanParam(value: unknown): boolean {
  const raw = Array.isArray(value) ? value[0] : value;
  return ['1', 'true', 'yes', 'sim'].includes(
    String(raw ?? '')
      .trim()
      .toLowerCase(),
  );
}

export const sydleController = {
  async listReport(req: Request, res: Response) {
    try {
      const filters = sydleReportQuerySchema.parse(req.query);
      const result = await sydleService.list(filters);
      sendPaginated(res, result.data, result.total, result.page, result.limit);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro ao buscar relatório SYDLE';
      sendError(res, message, 400);
    }
  },

  async getById(req: Request, res: Response) {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) {
        return sendError(res, 'ID de pagamento invalido', 400);
      }
      const payment = await sydleService.getPaymentById(id);
      if (!payment) {
        return sendError(res, 'Pagamento SYDLE nao encontrado', 404);
      }
      sendSuccess(res, req.user?.role === 'admin' ? payment : { ...payment, rawPayload: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro ao buscar pagamento SYDLE';
      sendError(res, message, 400);
    }
  },

  async summary(req: Request, res: Response) {
    try {
      const filters = sydleReportQuerySchema.parse(req.query);
      const summary = await sydleService.summary(filters);
      sendSuccess(res, summary);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro ao buscar resumo SYDLE';
      sendError(res, message, 400);
    }
  },

  async config(_req: Request, res: Response) {
    sendSuccess(res, sydleService.getConfigStatus());
  },

  async syncNow(req: Request, res: Response) {
    try {
      const full = booleanParam(req.query.full ?? req.body?.full);
      const result = await sydleService.sync('manual', req.user?.id ?? null, { full });
      sendSuccess(res, result);
    } catch (error: any) {
      sendError(res, error.message || 'Erro ao sincronizar SYDLE', 500);
    }
  },

  async syncRuns(req: Request, res: Response) {
    try {
      const { limit } = syncRunsQuerySchema.parse(req.query);
      const runs = await sydleService.getSyncRuns(limit);
      sendSuccess(res, runs);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro ao buscar histórico SYDLE';
      sendError(res, message, 400);
    }
  },

  async exportCsv(req: Request, res: Response) {
    try {
      const filters = sydleReportQuerySchema.parse({ ...req.query, page: 1, limit: 200 });
      const csv = await sydleService.exportCsv(filters);
      const filename = `sydle-compras-pagamentos-${localTodayIso()}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.status(200).send(`\uFEFF${csv}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro ao exportar CSV SYDLE';
      sendError(res, message, 400);
    }
  },

  async exportXlsx(req: Request, res: Response) {
    try {
      const filters = sydleReportQuerySchema.parse({ ...req.query, page: 1, limit: 200 });
      const workbook = await sydleService.exportXlsx(filters);
      const filename = `sydle-compras-pagamentos-${localTodayIso()}.xlsx`;
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.status(200).send(workbook);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro ao exportar XLSX SYDLE';
      sendError(res, message, 400);
    }
  },

  async exportPdf(req: Request, res: Response) {
    try {
      const filters = sydleReportQuerySchema.parse({ ...req.query, page: 1, limit: 200 });
      const pdf = await sydleService.exportPdf(filters);
      const filename = `sydle-compras-pagamentos-${localTodayIso()}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.status(200).send(pdf);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro ao exportar PDF SYDLE';
      sendError(res, message, 400);
    }
  },
};
