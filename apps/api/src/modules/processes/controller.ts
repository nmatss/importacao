import type { Request, Response } from 'express';
import { processService } from './service.js';
import { sendSuccess, sendError, sendPaginated } from '../../shared/utils/response.js';
import type { AuthenticatedRequest } from '../../shared/types/index.js';
import type { ProcessFilter } from './schema.js';

export const processController = {
  async list(req: Request, res: Response) {
    try {
      const { data, total, page, limit } = await processService.list(
        req.query as unknown as ProcessFilter,
      );
      sendPaginated(res, data, total, page, limit);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async getById(req: Request, res: Response) {
    try {
      const process = await processService.getById(Number(req.params.id));
      sendSuccess(res, process);
    } catch (error: any) {
      const status = error.statusCode || 404;
      sendError(res, error.message, status);
    }
  },

  async getDraftBlChecklist(req: Request, res: Response) {
    try {
      const checklist = await processService.getDraftBlChecklist(Number(req.params.id));
      sendSuccess(res, checklist);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async updateDraftBlChecklist(req: Request, res: Response) {
    try {
      const item = await processService.updateDraftBlChecklist(
        Number(req.params.id),
        req.body,
        req.user?.id ?? null,
      );
      sendSuccess(res, item);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async listCustomStages(req: Request, res: Response) {
    try {
      const stages = await processService.listCustomStages(Number(req.params.id));
      sendSuccess(res, stages);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async createCustomStage(req: Request, res: Response) {
    try {
      const stage = await processService.createCustomStage(
        Number(req.params.id),
        req.body,
        req.user?.id ?? null,
      );
      sendSuccess(res, stage, 201);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async updateCustomStage(req: Request, res: Response) {
    try {
      const stage = await processService.updateCustomStage(
        Number(req.params.id),
        Number(req.params.stageId),
        req.body,
        req.user?.id ?? null,
      );
      sendSuccess(res, stage);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async deleteCustomStage(req: Request, res: Response) {
    try {
      const result = await processService.deleteCustomStage(
        Number(req.params.id),
        Number(req.params.stageId),
        req.user?.id ?? null,
      );
      sendSuccess(res, result);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async listOperationalRecords(req: Request, res: Response) {
    try {
      const records = await processService.listOperationalRecords(Number(req.params.id));
      sendSuccess(res, records);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async createOperationalRecord(req: Request, res: Response) {
    try {
      const record = await processService.createOperationalRecord(
        Number(req.params.id),
        req.body,
        req.user?.id ?? null,
      );
      sendSuccess(res, record, 201);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async updateOperationalRecord(req: Request, res: Response) {
    try {
      const record = await processService.updateOperationalRecord(
        Number(req.params.id),
        Number(req.params.recordId),
        req.body,
        req.user?.id ?? null,
      );
      sendSuccess(res, record);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async deleteOperationalRecord(req: Request, res: Response) {
    try {
      const result = await processService.deleteOperationalRecord(
        Number(req.params.id),
        Number(req.params.recordId),
        req.user?.id ?? null,
      );
      sendSuccess(res, result);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async create(req: Request, res: Response) {
    try {
      const userId = (req as AuthenticatedRequest).user.id;
      const process = await processService.create(req.body, userId);
      sendSuccess(res, process, 201);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async createFromPreCons(req: Request, res: Response) {
    try {
      const userId = (req as AuthenticatedRequest).user.id;
      const result = await processService.createFromPreCons(req.body, userId);
      if (result.created) {
        sendSuccess(res, result.process, 201);
      } else {
        sendSuccess(res, { ...result.process, existed: true }, 200);
      }
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async rename(req: Request, res: Response) {
    try {
      const userId = req.user?.id ?? null;
      const { newProcessCode, reason } = req.body as { newProcessCode: string; reason?: string };
      const process = await processService.rename(
        Number(req.params.id),
        newProcessCode,
        reason,
        userId,
      );
      sendSuccess(res, process);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async lock(req: Request, res: Response) {
    try {
      const userId = req.user?.id ?? null;
      const reason = (req.body?.reason as string | undefined) ?? 'manual';
      const process = await processService.lock(Number(req.params.id), reason, userId);
      sendSuccess(res, process);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async unlock(req: Request, res: Response) {
    try {
      const userId = req.user?.id ?? null;
      const process = await processService.unlock(Number(req.params.id), userId);
      sendSuccess(res, process);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async update(req: Request, res: Response) {
    try {
      const userId = req.user?.id ?? null;
      const process = await processService.update(Number(req.params.id), req.body, userId);
      sendSuccess(res, process);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async updateStatus(req: Request, res: Response) {
    try {
      const userId = req.user?.id ?? null;
      const { status, reason } = req.body;
      const process = await processService.updateStatus(Number(req.params.id), status, userId, {
        reason: reason ?? null,
        actorRole: req.user?.role ?? null,
      });
      sendSuccess(res, process);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async updateLogisticStatus(req: Request, res: Response) {
    try {
      const userId = req.user?.id ?? null;
      const { logisticStatus } = req.body;
      const process = await processService.updateLogisticStatus(
        Number(req.params.id),
        logisticStatus,
        userId,
      );
      sendSuccess(res, process);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async delete(req: Request, res: Response) {
    try {
      const userId = req.user?.id ?? null;
      // Cancelar um processo ja CONCLUIDO exige motivo (ver assertReopenAllowed).
      // O corpo do DELETE e opcional, entao o motivo tambem aceita ?reason=.
      const reason =
        (req.body?.reason as string | undefined) ?? (req.query.reason as string | undefined);
      await processService.delete(Number(req.params.id), userId, {
        reason: reason ?? null,
        actorRole: req.user?.role ?? null,
      });
      sendSuccess(res, { message: 'Processo cancelado' });
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async getEvents(req: Request, res: Response) {
    try {
      // Teto igual ao de li-tracking: sem `Math.min`, `?limit=1000000` era
      // aceito e a timeline inteira ia para a resposta.
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
      const events = await processService.getEvents(Number(req.params.id), limit);
      sendSuccess(res, events);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async getStats(_req: Request, res: Response) {
    try {
      const stats = await processService.getStats();
      sendSuccess(res, stats);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },
};
