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
import {
  deriveLogisticStatus,
  isForwardTransition,
} from './logistic-auto-advance.js';

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
      conditions.push(ilike(importProcesses.processCode, `%${filter.search}%`));
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
    const [process] = await db
      .update(importProcesses)
      .set({
        ...input,
        updatedAt: new Date(),
      } as Partial<typeof importProcesses.$inferInsert>)
      .where(eq(importProcesses.id, id))
      .returning();

    if (!process) throw new NotFoundError('Processo', id);
    auditService.log(userId, 'update', 'process', id, { fields: Object.keys(input) }, null);
    return process;
  },

  async updateStatus(id: number, status: string, userId: number | null = null) {
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
