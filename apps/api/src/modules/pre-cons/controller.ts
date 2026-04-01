import type { Request, Response } from 'express';
import fs from 'fs/promises';
import { sendSuccess, sendError } from '../../shared/utils/response.js';
import { preConsService } from './service.js';
import { getPreConsItemsSchema } from './schema.js';

const MAX_XLSX_SIZE = 20 * 1024 * 1024; // 20MB for XLSX specifically
const ALLOWED_EXTENSIONS = /\.xlsx?$/i;

export const preConsController = {
  /**
   * POST /api/pre-cons/sync — Upload XLSX and sync Pre-Cons data
   */
  async sync(req: Request, res: Response) {
    try {
      if (!req.file) {
        return sendError(res, 'Nenhum arquivo enviado', 400);
      }

      if (!ALLOWED_EXTENSIONS.test(req.file.originalname)) {
        await fs.unlink(req.file.path).catch(() => {});
        return sendError(res, 'Apenas arquivos Excel (.xlsx, .xls) sao aceitos', 400);
      }

      if (req.file.size > MAX_XLSX_SIZE) {
        await fs.unlink(req.file.path).catch(() => {});
        return sendError(res, 'Arquivo excede o limite de 20MB', 413);
      }

      const buffer = await fs.readFile(req.file.path);
      const result = await preConsService.syncFromXLSX(buffer, req.file.originalname, 'upload');

      // Clean up uploaded file
      await fs.unlink(req.file.path).catch(() => {});

      sendSuccess(res, result, 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro ao sincronizar Pre-Cons';
      sendError(res, message, 500);
    }
  },

  /**
   * GET /api/pre-cons/items — List Pre-Cons items with optional filter
   */
  async getItems(req: Request, res: Response) {
    try {
      const parsed = getPreConsItemsSchema.safeParse(req.query);
      if (!parsed.success) {
        const errors = parsed.error.errors.map((e) => e.message).join('; ');
        return sendError(res, `Parametros invalidos: ${errors}`, 400);
      }

      const { page, limit, processCode, sheetName } = parsed.data;
      const result = await preConsService.getAll(page, limit, processCode, sheetName);

      res.json({
        success: true,
        data: result.data,
        pagination: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          pages: Math.ceil(result.total / result.limit),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro ao buscar itens';
      sendError(res, message, 400);
    }
  },

  /**
   * GET /api/pre-cons/process/:processCode — Get Pre-Cons items for a process
   */
  async getByProcess(req: Request, res: Response) {
    try {
      const items = await preConsService.getByProcessCode(req.params.processCode);
      sendSuccess(res, items);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro ao buscar itens do processo';
      sendError(res, message, 400);
    }
  },

  /**
   * GET /api/pre-cons/divergences — Find divergences between Pre-Cons and system
   */
  async getDivergences(req: Request, res: Response) {
    try {
      const divergences = await preConsService.findDivergences();
      sendSuccess(res, divergences);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro ao buscar divergencias';
      sendError(res, message, 400);
    }
  },

  /**
   * GET /api/pre-cons/sheets — Distinct sheet names for filter
   */
  async getSheets(req: Request, res: Response) {
    try {
      const sheets = await preConsService.getSheetNames();
      sendSuccess(res, sheets);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro ao buscar abas';
      sendError(res, message, 400);
    }
  },

  /**
   * GET /api/pre-cons/sync-logs — Sync history
   */
  async getSyncLogs(req: Request, res: Response) {
    try {
      const logs = await preConsService.getSyncLogs();
      sendSuccess(res, logs);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro ao buscar logs';
      sendError(res, message, 400);
    }
  },
};
