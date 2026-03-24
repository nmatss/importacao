import type { Request, Response } from 'express';
import fs from 'fs/promises';
import { sendSuccess, sendError } from '../../shared/utils/response.js';
import { preConsService } from './service.js';

export const preConsController = {
  /**
   * POST /api/pre-cons/sync — Upload XLSX and sync Pre-Cons data
   */
  async sync(req: Request, res: Response) {
    try {
      if (!req.file) {
        return sendError(res, 'Nenhum arquivo enviado', 400);
      }

      const buffer = await fs.readFile(req.file.path);
      const result = await preConsService.syncFromXLSX(buffer, req.file.originalname, 'upload');

      // Clean up uploaded file
      await fs.unlink(req.file.path).catch(() => {});

      sendSuccess(res, result, 200);
    } catch (error: any) {
      sendError(res, error.message || 'Erro ao sincronizar Pre-Cons', 500);
    }
  },

  /**
   * GET /api/pre-cons/items — List Pre-Cons items with optional filter
   */
  async getItems(req: Request, res: Response) {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 50;
      const processCode = req.query.processCode as string | undefined;

      const result = await preConsService.getAll(page, limit, processCode);
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
    } catch (error: any) {
      sendError(res, error.message, 400);
    }
  },

  /**
   * GET /api/pre-cons/process/:processCode — Get Pre-Cons items for a process
   */
  async getByProcess(req: Request, res: Response) {
    try {
      const items = await preConsService.getByProcessCode(req.params.processCode);
      sendSuccess(res, items);
    } catch (error: any) {
      sendError(res, error.message, 400);
    }
  },

  /**
   * GET /api/pre-cons/divergences — Find divergences between Pre-Cons and system
   */
  async getDivergences(req: Request, res: Response) {
    try {
      const divergences = await preConsService.findDivergences();
      sendSuccess(res, divergences);
    } catch (error: any) {
      sendError(res, error.message, 400);
    }
  },

  /**
   * GET /api/pre-cons/sync-logs — Sync history
   */
  async getSyncLogs(req: Request, res: Response) {
    try {
      const logs = await preConsService.getSyncLogs();
      sendSuccess(res, logs);
    } catch (error: any) {
      sendError(res, error.message, 400);
    }
  },
};
