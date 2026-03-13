import { eq, desc, ilike, and, sql, count } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import { importProcesses, documents, followUpTracking } from '../../shared/database/schema.js';
import type { CreateProcessInput, UpdateProcessInput, ProcessFilter } from './schema.js';
import { auditService } from '../audit/service.js';
import { assertTransition } from '../../shared/state-machine/process-states.js';
import type { ProcessStatus } from '../../shared/state-machine/process-states.js';
import { NotFoundError } from '../../shared/errors/index.js';

export const processService = {
  async list(filter: ProcessFilter) {
    const conditions = [];

    if (filter.status) {
      conditions.push(eq(importProcesses.status, filter.status as any));
    }
    if (filter.brand) {
      conditions.push(eq(importProcesses.brand, filter.brand as any));
    }
    if (filter.search) {
      conditions.push(ilike(importProcesses.processCode, `%${filter.search}%`));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (filter.page - 1) * filter.limit;

    const [data, [{ total }]] = await Promise.all([
      db.select()
        .from(importProcesses)
        .where(where)
        .orderBy(desc(importProcesses.createdAt))
        .limit(filter.limit)
        .offset(offset),
      db.select({ total: count() })
        .from(importProcesses)
        .where(where),
    ]);

    return { data, total, page: filter.page, limit: filter.limit };
  },

  async getById(id: number) {
    const [process] = await db.select()
      .from(importProcesses)
      .where(eq(importProcesses.id, id))
      .limit(1);

    if (!process) throw new NotFoundError('Processo', id);

    const processDocs = await db.select()
      .from(documents)
      .where(eq(documents.processId, id));

    const [followUp] = await db.select()
      .from(followUpTracking)
      .where(eq(followUpTracking.processId, id))
      .limit(1);

    return { ...process, documents: processDocs, followUp };
  },

  async create(input: CreateProcessInput, userId: number) {
    return db.transaction(async (tx) => {
      const [process] = await tx.insert(importProcesses).values({
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
        createdBy: userId,
      }).returning();

      await tx.insert(followUpTracking).values({
        processId: process.id,
      });

      auditService.log(userId, 'create', 'process', process.id, { processCode: input.processCode }, null);

      return process;
    });
  },

  async update(id: number, input: UpdateProcessInput, userId: number | null = null) {
    const [process] = await db.update(importProcesses)
      .set({ ...input, updatedAt: new Date() } as any)
      .where(eq(importProcesses.id, id))
      .returning();

    if (!process) throw new NotFoundError('Processo', id);
    auditService.log(userId, 'update', 'process', id, { fields: Object.keys(input) }, null);
    return process;
  },

  async updateStatus(id: number, status: string, userId: number | null = null) {
    const [current] = await db.select()
      .from(importProcesses)
      .where(eq(importProcesses.id, id))
      .limit(1);

    if (!current) throw new NotFoundError('Processo', id);

    assertTransition(current.status as ProcessStatus, status as ProcessStatus);

    const [process] = await db.update(importProcesses)
      .set({ status: status as any, updatedAt: new Date() })
      .where(eq(importProcesses.id, id))
      .returning();

    auditService.log(userId, 'status_update', 'process', id, { status }, null);
    return process;
  },

  async delete(id: number, userId: number | null = null) {
    const [current] = await db.select()
      .from(importProcesses)
      .where(eq(importProcesses.id, id))
      .limit(1);

    if (!current) throw new NotFoundError('Processo', id);

    assertTransition(current.status as ProcessStatus, 'cancelled');

    const [process] = await db.update(importProcesses)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(importProcesses.id, id))
      .returning({ id: importProcesses.id });
    auditService.log(userId, 'delete', 'process', id, null, null);
    return process;
  },

  async getStats() {
    const result = await db.select({
      status: importProcesses.status,
      count: count(),
      totalFob: sql<string>`COALESCE(SUM(${importProcesses.totalFobValue}), 0)`,
    })
      .from(importProcesses)
      .groupBy(importProcesses.status);

    return result;
  },
};
