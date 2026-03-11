import { eq, sql, count, and, ilike, type SQL } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import { liTracking, importProcesses } from '../../shared/database/schema.js';
import type { CreateLiTrackingInput, UpdateLiTrackingInput } from './schema.js';

export const liTrackingService = {
  async getAll(page = 1, limit = 20, filters: { processCode?: string; status?: string; orgao?: string } = {}) {
    const offset = (page - 1) * limit;
    const conditions: SQL[] = [];

    if (filters.processCode) {
      conditions.push(ilike(liTracking.processCode, `%${filters.processCode}%`));
    }
    if (filters.status) {
      conditions.push(eq(liTracking.status, filters.status as any));
    }
    if (filters.orgao) {
      conditions.push(ilike(liTracking.orgao, `%${filters.orgao}%`));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [data, [{ total }]] = await Promise.all([
      db.select({
        id: liTracking.id,
        processId: liTracking.processId,
        processCode: liTracking.processCode,
        brand: importProcesses.brand,
        orgao: liTracking.orgao,
        ncm: liTracking.ncm,
        item: liTracking.item,
        description: liTracking.description,
        supplier: liTracking.supplier,
        requestedByCompanyAt: liTracking.requestedByCompanyAt,
        submittedToFeniciaAt: liTracking.submittedToFeniciaAt,
        deferredAt: liTracking.deferredAt,
        expectedDeferralAt: liTracking.expectedDeferralAt,
        averageDays: liTracking.averageDays,
        validUntil: liTracking.validUntil,
        lpcoNumber: liTracking.lpcoNumber,
        etdOrigem: liTracking.etdOrigem,
        etaArmador: liTracking.etaArmador,
        status: liTracking.status,
        itemStatus: liTracking.itemStatus,
        observations: liTracking.observations,
        createdAt: liTracking.createdAt,
        updatedAt: liTracking.updatedAt,
      })
        .from(liTracking)
        .leftJoin(importProcesses, eq(liTracking.processId, importProcesses.id))
        .where(whereClause)
        .orderBy(liTracking.createdAt)
        .limit(limit)
        .offset(offset),
      db.select({ total: count() })
        .from(liTracking)
        .where(whereClause),
    ]);

    return { data, total, page, limit };
  },

  async getByProcess(processCode: string) {
    const data = await db.select({
      id: liTracking.id,
      processId: liTracking.processId,
      processCode: liTracking.processCode,
      brand: importProcesses.brand,
      orgao: liTracking.orgao,
      ncm: liTracking.ncm,
      item: liTracking.item,
      description: liTracking.description,
      supplier: liTracking.supplier,
      requestedByCompanyAt: liTracking.requestedByCompanyAt,
      submittedToFeniciaAt: liTracking.submittedToFeniciaAt,
      deferredAt: liTracking.deferredAt,
      expectedDeferralAt: liTracking.expectedDeferralAt,
      averageDays: liTracking.averageDays,
      validUntil: liTracking.validUntil,
      lpcoNumber: liTracking.lpcoNumber,
      etdOrigem: liTracking.etdOrigem,
      etaArmador: liTracking.etaArmador,
      status: liTracking.status,
      itemStatus: liTracking.itemStatus,
      observations: liTracking.observations,
      createdAt: liTracking.createdAt,
      updatedAt: liTracking.updatedAt,
    })
      .from(liTracking)
      .leftJoin(importProcesses, eq(liTracking.processId, importProcesses.id))
      .where(eq(liTracking.processCode, processCode));

    return data;
  },

  async getStats() {
    const [statusRows, orgaoRows] = await Promise.all([
      db.select({
        status: liTracking.status,
        count: count(),
      })
        .from(liTracking)
        .groupBy(liTracking.status),
      db.select({
        orgao: liTracking.orgao,
        count: count(),
      })
        .from(liTracking)
        .groupBy(liTracking.orgao),
    ]);

    const byStatus: Record<string, number> = {};
    for (const r of statusRows) byStatus[r.status] = r.count;

    const byOrgao: Record<string, number> = {};
    for (const r of orgaoRows) byOrgao[r.orgao || 'N/A'] = r.count;

    return { byStatus, byOrgao };
  },

  async create(input: CreateLiTrackingInput) {
    const [entry] = await db.insert(liTracking).values({
      processId: input.processId,
      processCode: input.processCode,
      orgao: input.orgao,
      ncm: input.ncm,
      item: input.item,
      description: input.description,
      supplier: input.supplier,
      requestedByCompanyAt: input.requestedByCompanyAt,
      submittedToFeniciaAt: input.submittedToFeniciaAt,
      deferredAt: input.deferredAt,
      expectedDeferralAt: input.expectedDeferralAt,
      averageDays: input.averageDays,
      validUntil: input.validUntil,
      lpcoNumber: input.lpcoNumber,
      etdOrigem: input.etdOrigem,
      etaArmador: input.etaArmador,
      status: input.status ?? 'pending',
      itemStatus: input.itemStatus,
      observations: input.observations,
    }).returning();

    return entry;
  },

  async update(id: number, input: UpdateLiTrackingInput) {
    const [entry] = await db.update(liTracking)
      .set({
        ...input,
        updatedAt: new Date(),
      })
      .where(eq(liTracking.id, id))
      .returning();

    if (!entry) throw new Error('LI tracking entry not found');
    return entry;
  },

  async delete(id: number) {
    const [entry] = await db.delete(liTracking)
      .where(eq(liTracking.id, id))
      .returning({ id: liTracking.id });

    if (!entry) throw new Error('LI tracking entry not found');
    return entry;
  },
};
