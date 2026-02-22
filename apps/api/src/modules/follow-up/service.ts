import { eq, sql, count } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import { followUpTracking, importProcesses } from '../../shared/database/schema.js';
import type { FollowUpTracking } from '../../shared/database/schema.js';

const TRACKING_STEPS = [
  'documentsReceivedAt',
  'preInspectionAt',
  'ncmVerifiedAt',
  'espelhoGeneratedAt',
  'sentToFeniciaAt',
  'liSubmittedAt',
  'liApprovedAt',
] as const;

function calculateProgress(tracking: Partial<FollowUpTracking>): number {
  const stepWeight = Math.floor(100 / TRACKING_STEPS.length);
  let progress = 0;

  for (const step of TRACKING_STEPS) {
    if (tracking[step]) {
      progress += stepWeight;
    }
  }

  return Math.min(progress, 100);
}

export const followUpService = {
  async getAll(page = 1, limit = 20) {
    const offset = (page - 1) * limit;

    const [data, [{ total }]] = await Promise.all([
      db.select({
        id: followUpTracking.id,
        processId: followUpTracking.processId,
        processCode: importProcesses.processCode,
        brand: importProcesses.brand,
        status: importProcesses.status,
        documentsReceivedAt: followUpTracking.documentsReceivedAt,
        preInspectionAt: followUpTracking.preInspectionAt,
        ncmVerifiedAt: followUpTracking.ncmVerifiedAt,
        espelhoGeneratedAt: followUpTracking.espelhoGeneratedAt,
        sentToFeniciaAt: followUpTracking.sentToFeniciaAt,
        liSubmittedAt: followUpTracking.liSubmittedAt,
        liApprovedAt: followUpTracking.liApprovedAt,
        liDeadline: followUpTracking.liDeadline,
        overallProgress: followUpTracking.overallProgress,
        notes: followUpTracking.notes,
        createdAt: followUpTracking.createdAt,
        updatedAt: followUpTracking.updatedAt,
      })
        .from(followUpTracking)
        .innerJoin(importProcesses, eq(followUpTracking.processId, importProcesses.id))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() })
        .from(followUpTracking),
    ]);

    return { data, total, page, limit };
  },

  async getByProcess(processId: number) {
    const [tracking] = await db.select()
      .from(followUpTracking)
      .where(eq(followUpTracking.processId, processId))
      .limit(1);

    if (!tracking) throw new Error('Acompanhamento não encontrado');
    return tracking;
  },

  async update(processId: number, data: Record<string, any>) {
    const ALLOWED_FIELDS = ['documentsReceivedAt', 'preInspectionAt', 'ncmVerifiedAt', 'espelhoGeneratedAt', 'sentToFeniciaAt', 'liSubmittedAt', 'liApprovedAt', 'liDeadline', 'notes'] as const;
    const safeData: Record<string, any> = {};
    for (const field of ALLOWED_FIELDS) {
      if (field in data) safeData[field] = data[field];
    }

    const overallProgress = calculateProgress(safeData);

    const [tracking] = await db.update(followUpTracking)
      .set({
        ...safeData,
        overallProgress,
        updatedAt: new Date(),
      })
      .where(eq(followUpTracking.processId, processId))
      .returning();

    if (!tracking) throw new Error('Acompanhamento não encontrado');
    return tracking;
  },

  async getLiDeadlines() {
    const results = await db.select({
      processId: importProcesses.id,
      processCode: importProcesses.processCode,
      brand: importProcesses.brand,
      status: importProcesses.status,
      shipmentDate: importProcesses.shipmentDate,
      liDeadline: sql<string>`${importProcesses.shipmentDate}::date + 13`,
      daysRemaining: sql<number>`${importProcesses.shipmentDate}::date + 13 - CURRENT_DATE`,
      liSubmittedAt: followUpTracking.liSubmittedAt,
      liApprovedAt: followUpTracking.liApprovedAt,
    })
      .from(importProcesses)
      .innerJoin(followUpTracking, eq(followUpTracking.processId, importProcesses.id))
      .where(eq(importProcesses.hasLiItems, true));

    return results;
  },
};
