import { eq, desc, ilike, and, sql, count, gte } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import {
  importProcesses,
  documents,
  followUpTracking,
  processEvents,
  users,
} from '../../shared/database/schema.js';
import type {
  CreateProcessInput,
  UpdateProcessInput,
  ProcessFilter,
  CreateFromPreConsInput,
} from './schema.js';
import { auditService } from '../audit/service.js';
import { assertTransition } from '../../shared/state-machine/process-states.js';
import type { ProcessStatus } from '../../shared/state-machine/process-states.js';
import { NotFoundError } from '../../shared/errors/index.js';
import { recordProcessEvent } from '../../shared/utils/process-events.js';
import { deriveLogisticStatus, isForwardTransition } from './logistic-auto-advance.js';

export const processService = {
  async list(filter: ProcessFilter) {
    const conditions = [];

    if (filter.status) {
      conditions.push(
        eq(
          importProcesses.status,
          filter.status as (typeof importProcesses.status.enumValues)[number],
        ),
      );
    }
    if (filter.brand) {
      conditions.push(
        eq(
          importProcesses.brand,
          filter.brand as (typeof importProcesses.brand.enumValues)[number],
        ),
      );
    }
    if (filter.search) {
      // Match current processCode OR any previous code in the rename history
      // (Pre-Cons periodically renumbers: 209 → 208 etc.).
      conditions.push(
        sql`(${importProcesses.processCode} ILIKE ${`%${filter.search}%`}
             OR ${importProcesses.previousCodes}::text ILIKE ${`%${filter.search}%`})`,
      );
    }
    if (filter.startDate) {
      conditions.push(gte(importProcesses.createdAt, new Date(filter.startDate)));
    }
    if (filter.endDate) {
      const endDate = new Date(filter.endDate);
      endDate.setDate(endDate.getDate() + 1);
      conditions.push(sql`${importProcesses.createdAt} < ${endDate.toISOString()}`);
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (filter.page - 1) * filter.limit;

    const [data, [{ total }]] = await Promise.all([
      db
        .select()
        .from(importProcesses)
        .where(where)
        .orderBy(desc(importProcesses.createdAt))
        .limit(filter.limit)
        .offset(offset),
      db.select({ total: count() }).from(importProcesses).where(where),
    ]);

    return { data, total, page: filter.page, limit: filter.limit };
  },

  async getById(id: number) {
    const [process] = await db
      .select()
      .from(importProcesses)
      .where(eq(importProcesses.id, id))
      .limit(1);

    if (!process) throw new NotFoundError('Processo', id);

    const [processDocs, [followUp]] = await Promise.all([
      db.select().from(documents).where(eq(documents.processId, id)),
      db.select().from(followUpTracking).where(eq(followUpTracking.processId, id)).limit(1),
    ]);

    return { ...process, documents: processDocs, followUp };
  },

  async create(input: CreateProcessInput, userId: number) {
    return db.transaction(async (tx) => {
      const [process] = await tx
        .insert(importProcesses)
        .values({
          processCode: input.processCode,
          brand: input.brand,
          incoterm: input.incoterm,
          portOfLoading: input.portOfLoading,
          portOfDischarge: input.portOfDischarge,
          etd: input.etd,
          eta: input.eta,
          exporterName: input.exporterName,
          exporterAddress: input.exporterAddress,
          importerName: input.importerName,
          importerAddress: input.importerAddress,
          notes: input.notes,
          logisticStatus: 'consolidation',
          createdBy: userId,
        })
        .returning();

      await tx.insert(followUpTracking).values({
        processId: process.id,
      });

      auditService.log(
        userId,
        'create',
        'process',
        process.id,
        { processCode: input.processCode },
        null,
      );

      return process;
    });
  },

  async createFromPreCons(input: CreateFromPreConsInput, userId: number) {
    const [existing] = await db
      .select()
      .from(importProcesses)
      .where(eq(importProcesses.processCode, input.processCode))
      .limit(1);

    if (existing) {
      return { created: false as const, process: existing };
    }

    const process = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(importProcesses)
        .values({
          processCode: input.processCode,
          brand: input.brand,
          status: 'draft',
          logisticStatus: 'consolidation',
          etd: input.etd,
          eta: input.eta,
          notes: input.notes ?? 'Criado a partir do Pre-Cons',
          createdBy: userId,
        })
        .returning();

      await tx.insert(followUpTracking).values({
        processId: created.id,
      });

      auditService.log(
        userId,
        'create_from_pre_cons',
        'process',
        created.id,
        { processCode: input.processCode, preConsCode: input.preConsCode ?? null },
        null,
      );

      return created;
    });

    recordProcessEvent(
      process.id,
      {
        eventType: 'created_from_pre_cons',
        title: 'Processo criado a partir do Pre-Cons',
        metadata: { processCode: input.processCode, source: 'pre_cons_manual' },
      },
      userId,
    );

    return { created: true as const, process };
  },

  async advanceLogisticStatus(processId: number, userId: number | null = null) {
    await this.assertNotLocked(processId);
    const [process] = await db
      .select()
      .from(importProcesses)
      .where(eq(importProcesses.id, processId))
      .limit(1);

    if (!process) return { updated: false as const, current: null };

    const [followUp] = await db
      .select()
      .from(followUpTracking)
      .where(eq(followUpTracking.processId, processId))
      .limit(1);

    const derived = deriveLogisticStatus({
      process: {
        etd: process.etd ?? null,
        eta: process.eta ?? null,
        shipmentDate: process.shipmentDate ?? null,
        customsChannel: process.customsChannel ?? null,
        diNumber: process.diNumber ?? null,
        customsClearanceAt: process.customsClearanceAt ?? null,
        cdArrivalAt: process.cdArrivalAt ?? null,
        logisticStatus: process.logisticStatus ?? null,
        status: process.status,
      },
      followUp: followUp
        ? {
            espelhoBuiltAt: followUp.espelhoBuiltAt ?? null,
            espelhoGeneratedAt: followUp.espelhoGeneratedAt ?? null,
            sentToFeniciaAt: followUp.sentToFeniciaAt ?? null,
            invoiceSentFeniciaAt: followUp.invoiceSentFeniciaAt ?? null,
            documentsReceivedAt: followUp.documentsReceivedAt ?? null,
          }
        : null,
    });

    if (!isForwardTransition(process.logisticStatus, derived)) {
      return { updated: false as const, current: process.logisticStatus };
    }

    if (process.logisticStatus === derived) {
      return { updated: false as const, current: process.logisticStatus };
    }

    const previousStatus = process.logisticStatus;

    await db
      .update(importProcesses)
      .set({ logisticStatus: derived, updatedAt: new Date() })
      .where(eq(importProcesses.id, processId));

    auditService.log(
      userId,
      'logistic_status_auto_advance',
      'process',
      processId,
      { previousStatus, newStatus: derived },
      null,
    );

    recordProcessEvent(
      processId,
      {
        eventType: 'logistic_status_auto_advanced',
        title: `Status logistico avancado para ${derived}`,
        metadata: { previousStatus, newStatus: derived, source: 'auto_advance' },
      },
      userId,
    );

    return { updated: true as const, previous: previousStatus, current: derived };
  },

  async update(id: number, input: UpdateProcessInput, userId: number | null = null) {
    await this.assertNotLocked(id);

    // If processCode is in the patch and changed, route through rename() so the
    // previousCodes history is captured. Otherwise normal update.
    if (input.processCode) {
      const [current] = await db
        .select({ processCode: importProcesses.processCode })
        .from(importProcesses)
        .where(eq(importProcesses.id, id))
        .limit(1);
      if (!current) throw new NotFoundError('Processo', id);
      if (input.processCode !== current.processCode) {
        await this.rename(id, input.processCode, 'inline_edit', userId);
      }
    }

    const { processCode: _drop, ...rest } = input;
    const [process] = await db
      .update(importProcesses)
      .set({
        ...rest,
        updatedAt: new Date(),
      } as Partial<typeof importProcesses.$inferInsert>)
      .where(eq(importProcesses.id, id))
      .returning();

    if (!process) throw new NotFoundError('Processo', id);
    auditService.log(userId, 'update', 'process', id, { fields: Object.keys(input) }, null);
    return process;
  },

  /**
   * Throws a 423-mappable error when the process is locked (Vimbar-approved
   * or manually). Lock = "depois da aprovação aqui não é pra ter mais
   * mudança" (Nicolas, 2026-05-21 meeting).
   */
  async assertNotLocked(id: number) {
    const [row] = await db
      .select({ lockedAt: importProcesses.lockedAt, lockedReason: importProcesses.lockedReason })
      .from(importProcesses)
      .where(eq(importProcesses.id, id))
      .limit(1);
    if (row && row.lockedAt) {
      const err: Error & { statusCode?: number } = new Error(
        `Processo travado em ${row.lockedAt.toISOString()} (motivo: ${row.lockedReason ?? 'sem motivo registrado'}). Destrave antes de alterar.`,
      );
      err.statusCode = 423;
      throw err;
    }
  },

  async rename(
    id: number,
    newProcessCode: string,
    reason: string | undefined,
    userId: number | null = null,
  ) {
    await this.assertNotLocked(id);

    const trimmed = newProcessCode.trim();
    if (!trimmed) {
      const err: Error & { statusCode?: number } = new Error('Novo código vazio.');
      err.statusCode = 400;
      throw err;
    }

    // Single transaction: SELECT current + check conflict + UPDATE.
    // Compare codes case-insensitively to detect no-op (and prevent history
    // pollution like "IMP001 já foi IMP001" when only case differs).
    try {
      return await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(importProcesses)
          .where(eq(importProcesses.id, id))
          .limit(1);
        if (!current) throw new NotFoundError('Processo', id);

        if (trimmed.toLowerCase() === current.processCode.toLowerCase()) {
          return current;
        }

        const history = Array.isArray(current.previousCodes)
          ? [...(current.previousCodes as string[])]
          : [];
        history.push(current.processCode);

        const [updated] = await tx
          .update(importProcesses)
          .set({
            processCode: trimmed,
            previousCodes: history,
            updatedAt: new Date(),
          })
          .where(eq(importProcesses.id, id))
          .returning();

        auditService.log(
          userId,
          'rename',
          'process',
          id,
          { from: current.processCode, to: trimmed, reason: reason ?? null },
          null,
        );

        recordProcessEvent(
          id,
          {
            eventType: 'process_renamed',
            title: `Referência alterada: ${current.processCode} → ${trimmed}`,
            metadata: { from: current.processCode, to: trimmed, reason: reason ?? null },
          },
          userId,
        );

        return updated;
      });
    } catch (err: any) {
      // Map unique-violation (23505) into a friendly 409 instead of a 500.
      if (err?.code === '23505' || /unique constraint/i.test(err?.message ?? '')) {
        const conflict: Error & { statusCode?: number } = new Error(
          `Já existe um processo com o código ${trimmed}.`,
        );
        conflict.statusCode = 409;
        throw conflict;
      }
      throw err;
    }
  },

  async lock(id: number, reason: string, userId: number | null = null) {
    const [current] = await db
      .select({ id: importProcesses.id, lockedAt: importProcesses.lockedAt })
      .from(importProcesses)
      .where(eq(importProcesses.id, id))
      .limit(1);
    if (!current) throw new NotFoundError('Processo', id);
    if (current.lockedAt) return current; // already locked, idempotent

    const lockedAt = new Date();
    const [updated] = await db
      .update(importProcesses)
      .set({ lockedAt, lockedReason: reason, updatedAt: lockedAt })
      .where(eq(importProcesses.id, id))
      .returning();

    auditService.log(userId, 'lock', 'process', id, { reason }, null);
    recordProcessEvent(
      id,
      {
        eventType: 'process_locked',
        title: `Processo travado (${reason})`,
        metadata: { reason, lockedAt: lockedAt.toISOString() },
      },
      userId,
    );

    return updated;
  },

  async unlock(id: number, userId: number | null = null) {
    const [current] = await db
      .select({ id: importProcesses.id, lockedAt: importProcesses.lockedAt })
      .from(importProcesses)
      .where(eq(importProcesses.id, id))
      .limit(1);
    if (!current) throw new NotFoundError('Processo', id);
    if (!current.lockedAt) return current;

    const [updated] = await db
      .update(importProcesses)
      .set({ lockedAt: null, lockedReason: null, updatedAt: new Date() })
      .where(eq(importProcesses.id, id))
      .returning();

    auditService.log(userId, 'unlock', 'process', id, {}, null);
    recordProcessEvent(
      id,
      {
        eventType: 'process_unlocked',
        title: 'Processo destravado manualmente',
        metadata: {},
      },
      userId,
    );

    return updated;
  },

  async updateStatus(id: number, status: string, userId: number | null = null) {
    await this.assertNotLocked(id);
    const [current] = await db
      .select()
      .from(importProcesses)
      .where(eq(importProcesses.id, id))
      .limit(1);

    if (!current) throw new NotFoundError('Processo', id);

    assertTransition(current.status as ProcessStatus, status as ProcessStatus);

    const [process] = await db
      .update(importProcesses)
      .set({
        status: status as (typeof importProcesses.status.enumValues)[number],
        updatedAt: new Date(),
      })
      .where(eq(importProcesses.id, id))
      .returning();

    auditService.log(userId, 'status_update', 'process', id, { status }, null);

    recordProcessEvent(
      id,
      {
        eventType: 'status_changed',
        title: `Status alterado para ${status}`,
        metadata: { previousStatus: current.status, newStatus: status },
      },
      userId,
    );

    return process;
  },

  async delete(id: number, userId: number | null = null) {
    await this.assertNotLocked(id);
    const [current] = await db
      .select()
      .from(importProcesses)
      .where(eq(importProcesses.id, id))
      .limit(1);

    if (!current) throw new NotFoundError('Processo', id);

    assertTransition(current.status as ProcessStatus, 'cancelled');

    const [process] = await db
      .update(importProcesses)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(importProcesses.id, id))
      .returning({ id: importProcesses.id });
    auditService.log(userId, 'delete', 'process', id, null, null);
    return process;
  },

  async updateLogisticStatus(id: number, logisticStatus: string, userId: number | null = null) {
    await this.assertNotLocked(id);
    const [current] = await db
      .select()
      .from(importProcesses)
      .where(eq(importProcesses.id, id))
      .limit(1);

    if (!current) throw new NotFoundError('Processo', id);

    const previousStatus = current.logisticStatus;

    const [process] = await db
      .update(importProcesses)
      .set({
        logisticStatus,
        updatedAt: new Date(),
      })
      .where(eq(importProcesses.id, id))
      .returning();

    auditService.log(
      userId,
      'logistic_status_update',
      'process',
      id,
      { logisticStatus, previousStatus },
      null,
    );

    recordProcessEvent(
      id,
      {
        eventType: 'logistic_status_changed',
        title: `Status logistico: ${logisticStatus}`,
        metadata: { previousStatus, newStatus: logisticStatus },
      },
      userId,
    );

    return process;
  },

  async getEvents(processId: number, limit = 50) {
    const rows = await db
      .select({
        id: processEvents.id,
        processId: processEvents.processId,
        eventType: processEvents.eventType,
        title: processEvents.title,
        description: processEvents.description,
        metadata: processEvents.metadata,
        createdBy: processEvents.createdBy,
        createdAt: processEvents.createdAt,
        userName: users.name,
      })
      .from(processEvents)
      .leftJoin(users, eq(processEvents.createdBy, users.id))
      .where(eq(processEvents.processId, processId))
      .orderBy(desc(processEvents.createdAt))
      .limit(limit);

    return rows;
  },

  async getStats() {
    const result = await db
      .select({
        status: importProcesses.status,
        count: count(),
        totalFob: sql<string>`COALESCE(SUM(${importProcesses.totalFobValue}), 0)`,
      })
      .from(importProcesses)
      .groupBy(importProcesses.status);

    return result;
  },
};
