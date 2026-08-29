import { eq, sql, count, and, desc } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import {
  followUpTracking,
  importProcesses,
  processEvents,
  users,
} from '../../shared/database/schema.js';
import type { FollowUpTracking } from '../../shared/database/schema.js';
import { googleSheetsService } from '../integrations/google-sheets.service.js';
import { logger } from '../../shared/utils/logger.js';
import { NotFoundError } from '../../shared/errors/index.js';
import { processService } from '../processes/service.js';
import { recordProcessEvent } from '../../shared/utils/process-events.js';
import {
  localDayStartUtc,
  localDayEndExclusiveUtc,
  SQL_HOJE_LOCAL,
} from '../../shared/utils/dates.js';

const TRACKING_STEPS = [
  'documentsReceivedAt',
  'preInspectionAt',
  'savedToFolderAt',
  'ncmVerifiedAt',
  'ncmBlCheckedAt',
  'freightBlCheckedAt',
  'espelhoBuiltAt',
  'invoiceSentFeniciaAt',
  'espelhoGeneratedAt',
  'signaturesCollectedAt',
  'signedDocsSentAt',
  'sentToFeniciaAt',
  'diDraftAt',
  'liSubmittedAt',
  'liApprovedAt',
] as const;

const TRACKING_STEP_LABELS: Record<(typeof TRACKING_STEPS)[number], string> = {
  documentsReceivedAt: 'Documentos recebidos',
  preInspectionAt: 'Pre-inspecao',
  savedToFolderAt: 'Salvo na pasta',
  ncmVerifiedAt: 'NCM verificado',
  ncmBlCheckedAt: 'NCM BL conferido',
  freightBlCheckedAt: 'Frete BL conferido',
  espelhoBuiltAt: 'Espelho montado',
  invoiceSentFeniciaAt: 'Invoice enviada Fenicia',
  espelhoGeneratedAt: 'Espelho gerado',
  signaturesCollectedAt: 'Assinaturas coletadas',
  signedDocsSentAt: 'Documentos assinados enviados',
  sentToFeniciaAt: 'Enviado para Fenicia',
  diDraftAt: 'Rascunho DI',
  liSubmittedAt: 'LI protocolada',
  liApprovedAt: 'LI aprovada',
};

function calculateProgress(tracking: Partial<FollowUpTracking>): number {
  const completedSteps = TRACKING_STEPS.reduce(
    (total, step) => total + (tracking[step] ? 1 : 0),
    0,
  );

  // Do not use an integer weight per stage: 15 * floor(100 / 15) capped a
  // fully completed follow-up at 90%. The displayed progress is a business
  // completion indicator, so every persisted milestone must be able to reach
  // exactly 100%.
  return Math.round((completedSteps / TRACKING_STEPS.length) * 100);
}

async function recordChecklistEvent(
  processId: number,
  step: (typeof TRACKING_STEPS)[number],
  previousStatus: 'pendente' | 'feito',
  newStatus: 'pendente' | 'feito',
  completedAt: Date | null,
  userId: number | null,
  userName: string | null,
) {
  if (previousStatus === newStatus) return;

  const label = TRACKING_STEP_LABELS[step];
  await recordProcessEvent(
    processId,
    {
      eventType: 'checklist_step_changed',
      title: `Checklist: ${label} ${newStatus}`,
      description: `${label}: ${previousStatus} -> ${newStatus}`,
      metadata: {
        step,
        item: label,
        previousStatus,
        newStatus,
        completedAt: completedAt?.toISOString() ?? null,
        // Persist who acted so the checklist can show "Concluido por <nome>".
        // Stored in the event metadata (no schema migration on follow_up_tracking).
        completedBy: userId,
        completedByName: userName,
      },
    },
    userId,
  );
}

/**
 * Resolves the display name of the acting user for checklist attribution.
 * The JWT payload only carries id/email/role, so we look up the name.
 */
async function resolveUserName(userId: number | null): Promise<string | null> {
  if (!userId) return null;
  try {
    const [u] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return u?.name ?? null;
  } catch {
    return null;
  }
}

export interface StepCompletedBy {
  completedBy: number | null;
  completedByName: string | null;
  completedAt: string | null;
}

/**
 * Builds a map of { [stepKey]: { completedBy, completedByName, completedAt } } from the
 * most recent checklist_step_changed event per step. Falls back to the event author's
 * current name when the metadata snapshot lacks a name (older events).
 */
async function getStepCompletedByMap(processId: number): Promise<Record<string, StepCompletedBy>> {
  try {
    const events = await db
      .select({
        metadata: processEvents.metadata,
        createdBy: processEvents.createdBy,
        createdAt: processEvents.createdAt,
        authorName: users.name,
      })
      .from(processEvents)
      .leftJoin(users, eq(processEvents.createdBy, users.id))
      .where(
        and(
          eq(processEvents.processId, processId),
          eq(processEvents.eventType, 'checklist_step_changed'),
        ),
      )
      .orderBy(desc(processEvents.createdAt));

    const map: Record<string, StepCompletedBy> = {};
    for (const ev of events) {
      const meta = (ev.metadata ?? {}) as Record<string, unknown>;
      const step = typeof meta.step === 'string' ? meta.step : null;
      if (!step || meta.newStatus !== 'feito') continue;
      // First occurrence wins because rows are ordered newest-first.
      if (map[step]) continue;
      map[step] = {
        completedBy: ev.createdBy ?? null,
        completedByName:
          (typeof meta.completedByName === 'string' ? meta.completedByName : null) ??
          ev.authorName ??
          null,
        completedAt: typeof meta.completedAt === 'string' ? meta.completedAt : null,
      };
    }
    return map;
  } catch {
    return {};
  }
}

export const followUpService = {
  async getAll(page = 1, limit = 20, startDate?: string, endDate?: string) {
    const offset = (page - 1) * limit;
    const conditions = [];

    // O dia escolhido no calendario local vira o intervalo UTC equivalente.
    const start = startDate ? localDayStartUtc(startDate) : null;
    if (start) {
      conditions.push(sql`${followUpTracking.updatedAt} >= ${start.toISOString()}`);
    }
    // Limite superior EXCLUSIVO: inicio do dia local seguinte, em UTC.
    const end = endDate ? localDayEndExclusiveUtc(endDate) : null;
    if (end) {
      conditions.push(sql`${followUpTracking.updatedAt} < ${end.toISOString()}`);
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [data, [{ total }]] = await Promise.all([
      db
        .select({
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
        .where(where)
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(followUpTracking).where(where),
    ]);

    return { data, total, page, limit };
  },

  async getByProcess(processId: number) {
    const [tracking] = await db
      .select()
      .from(followUpTracking)
      .where(eq(followUpTracking.processId, processId))
      .limit(1);

    if (!tracking) throw new NotFoundError('Acompanhamento não encontrado');

    // Enrich with per-step attribution ("Concluido por <nome>") derived from the
    // latest checklist_step_changed event for each step. No schema migration needed.
    const stepCompletedBy = await getStepCompletedByMap(processId);
    if (Object.keys(stepCompletedBy).length > 0) {
      return { ...tracking, stepCompletedBy };
    }
    return tracking;
  },

  async update(processId: number, data: Record<string, any>) {
    const ALLOWED_FIELDS = [
      'documentsReceivedAt',
      'preInspectionAt',
      'ncmVerifiedAt',
      'espelhoGeneratedAt',
      'sentToFeniciaAt',
      'liSubmittedAt',
      'liApprovedAt',
      'liDeadline',
      'notes',
    ] as const;
    const safeData: Record<string, any> = {};
    for (const field of ALLOWED_FIELDS) {
      if (field in data) safeData[field] = data[field];
    }

    // Merge existing tracking data with incoming changes to calculate correct progress
    const [existing] = await db
      .select()
      .from(followUpTracking)
      .where(eq(followUpTracking.processId, processId))
      .limit(1);

    const merged = { ...(existing ?? {}), ...safeData };
    const overallProgress = calculateProgress(merged);

    const [tracking] = await db
      .update(followUpTracking)
      .set({
        ...safeData,
        overallProgress,
        updatedAt: new Date(),
      })
      .where(eq(followUpTracking.processId, processId))
      .returning();

    if (!tracking) throw new NotFoundError('Acompanhamento não encontrado');

    processService
      .advanceLogisticStatus(processId)
      .catch((err) =>
        logger.error({ err, processId }, 'advanceLogisticStatus failed after follow-up update'),
      );

    return tracking;
  },

  async updateStep(
    processId: number,
    step: string,
    completedAt: Date | null,
    userId: number | null = null,
  ) {
    // Validate step name
    const validSteps = TRACKING_STEPS as readonly string[];
    if (!validSteps.includes(step)) {
      throw new Error(`Passo invalido: ${step}. Passos validos: ${validSteps.join(', ')}`);
    }
    const typedStep = step as (typeof TRACKING_STEPS)[number];

    // Check if tracking exists, create if not
    const [existing] = await db
      .select()
      .from(followUpTracking)
      .where(eq(followUpTracking.processId, processId))
      .limit(1);

    const previousStatus = existing?.[typedStep] ? 'feito' : 'pendente';
    const newStatus = completedAt ? 'feito' : 'pendente';
    const userName = await resolveUserName(userId);

    if (!existing) {
      const [created] = await db
        .insert(followUpTracking)
        .values({ processId, [step]: completedAt })
        .returning();
      const progress = calculateProgress(created);
      const [updated] = await db
        .update(followUpTracking)
        .set({ overallProgress: progress })
        .where(eq(followUpTracking.processId, processId))
        .returning();
      await recordChecklistEvent(
        processId,
        typedStep,
        previousStatus,
        newStatus,
        completedAt,
        userId,
        userName,
      );
      const stepCompletedBy = await getStepCompletedByMap(processId);
      return Object.keys(stepCompletedBy).length > 0 ? { ...updated, stepCompletedBy } : updated;
    }

    const [updated] = await db
      .update(followUpTracking)
      .set({ [step]: completedAt, updatedAt: new Date() })
      .where(eq(followUpTracking.processId, processId))
      .returning();

    const progress = calculateProgress(updated);
    const [final] = await db
      .update(followUpTracking)
      .set({ overallProgress: progress })
      .where(eq(followUpTracking.processId, processId))
      .returning();

    processService
      .advanceLogisticStatus(processId)
      .catch((err) =>
        logger.error({ err, processId }, 'advanceLogisticStatus failed after follow-up updateStep'),
      );

    await recordChecklistEvent(
      processId,
      typedStep,
      previousStatus,
      newStatus,
      completedAt,
      userId,
      userName,
    );

    const stepCompletedBy = await getStepCompletedByMap(processId);
    return Object.keys(stepCompletedBy).length > 0 ? { ...final, stepCompletedBy } : final;
  },

  async compareWithSheet(processCode: string) {
    const sheetData = await googleSheetsService.readProcessRow(processCode);
    if (!sheetData) {
      throw new Error('Processo nao encontrado na planilha Follow-Up');
    }

    // Find the process in DB
    const [process] = await db
      .select()
      .from(importProcesses)
      .where(eq(importProcesses.processCode, processCode));

    if (!process) {
      throw new Error('Processo nao encontrado no sistema');
    }

    // Map common sheet column names to DB fields (flexible mapping)
    const fieldMap: Record<string, { dbField: keyof typeof process; sheetKeys: string[] }> = {
      supplier: { dbField: 'exporterName', sheetKeys: ['Fornecedor', 'Supplier', 'FORNECEDOR'] },
      brand: { dbField: 'brand', sheetKeys: ['Marca', 'Brand', 'MARCA'] },
      fobValue: {
        dbField: 'totalFobValue',
        sheetKeys: ['FOB', 'Valor FOB', 'FOB Total', 'VALOR FOB'],
      },
      freightValue: { dbField: 'freightValue', sheetKeys: ['Frete', 'Freight', 'FRETE'] },
      etd: { dbField: 'etd', sheetKeys: ['ETD', 'Data Embarque', 'EMBARQUE'] },
      eta: { dbField: 'eta', sheetKeys: ['ETA', 'Previsao Chegada', 'CHEGADA'] },
      incoterm: { dbField: 'incoterm', sheetKeys: ['Incoterm', 'INCOTERM'] },
      totalBoxes: {
        dbField: 'totalBoxes',
        sheetKeys: ['Caixas', 'Volumes', 'CAIXAS', 'QTD CAIXAS'],
      },
      containerType: {
        dbField: 'containerType',
        sheetKeys: ['Container', 'CONTAINER', 'Tipo Container'],
      },
      totalCbm: { dbField: 'totalCbm', sheetKeys: ['CBM', 'M3', 'CUBAGEM'] },
      totalGrossWeight: {
        dbField: 'totalGrossWeight',
        sheetKeys: ['Peso Bruto', 'PESO BRUTO', 'Gross Weight'],
      },
    };

    const differences: Array<{
      field: string;
      sheetValue: string;
      systemValue: string;
      sheetColumn: string;
    }> = [];

    const matched: Array<{
      field: string;
      value: string;
      sheetColumn: string;
    }> = [];

    for (const [fieldName, mapping] of Object.entries(fieldMap)) {
      // Find the matching sheet column
      let sheetValue = '';
      let sheetColumn = '';
      for (const key of mapping.sheetKeys) {
        if (sheetData[key] !== undefined && sheetData[key] !== '') {
          sheetValue = sheetData[key];
          sheetColumn = key;
          break;
        }
      }

      if (!sheetColumn) continue; // Column not found in sheet

      const dbValue = process[mapping.dbField];
      const dbStr = dbValue != null ? String(dbValue).trim() : '';
      const sheetStr = sheetValue.trim();

      // Compare (case-insensitive, number-tolerant)
      const dbNum = parseFloat(dbStr.replace(/[^\d.,-]/g, '').replace(',', '.'));
      const sheetNum = parseFloat(sheetStr.replace(/[^\d.,-]/g, '').replace(',', '.'));

      const isNumeric = !isNaN(dbNum) && !isNaN(sheetNum);
      const isMatch = isNumeric
        ? Math.abs(dbNum - sheetNum) < 0.01
        : dbStr.toLowerCase() === sheetStr.toLowerCase();

      if (!isMatch && sheetStr) {
        differences.push({
          field: fieldName,
          sheetValue: sheetStr,
          systemValue: dbStr || '(vazio)',
          sheetColumn,
        });
      } else if (sheetStr) {
        matched.push({ field: fieldName, value: sheetStr, sheetColumn });
      }
    }

    return {
      processCode,
      sheetData,
      differences,
      matched,
      hasDifferences: differences.length > 0,
    };
  },

  async syncFromSheet(processCode: string, mode: 'conservative' | 'industrial' = 'conservative') {
    const comparison = await this.compareWithSheet(processCode);

    if (!comparison.hasDifferences) {
      return { updated: false, message: 'Nenhuma diferenca encontrada', comparison };
    }

    if (mode === 'conservative') {
      // Conservative mode: just return differences for manual review
      return { updated: false, message: 'Modo conservador: aprovacao necessaria', comparison };
    }

    // Industrial mode: auto-update DB from sheet
    const [process] = await db
      .select()
      .from(importProcesses)
      .where(eq(importProcesses.processCode, processCode));

    if (!process) throw new Error('Processo nao encontrado');

    const updates: Record<string, any> = {};
    const fieldToDb: Record<string, string> = {
      fobValue: 'totalFobValue',
      freightValue: 'freightValue',
      etd: 'etd',
      eta: 'eta',
      totalBoxes: 'totalBoxes',
      containerType: 'containerType',
      totalCbm: 'totalCbm',
      totalGrossWeight: 'totalGrossWeight',
    };

    for (const diff of comparison.differences) {
      const dbField = fieldToDb[diff.field];
      if (!dbField) continue;

      const numericFields = [
        'totalFobValue',
        'freightValue',
        'totalBoxes',
        'totalCbm',
        'totalGrossWeight',
      ];
      if (numericFields.includes(dbField)) {
        const num = parseFloat(diff.sheetValue.replace(/[^\d.,-]/g, '').replace(',', '.'));
        if (!isNaN(num)) updates[dbField] = num;
      } else {
        updates[dbField] = diff.sheetValue;
      }
    }

    if (Object.keys(updates).length > 0) {
      updates.updatedAt = new Date();
      await db.update(importProcesses).set(updates).where(eq(importProcesses.id, process.id));

      logger.info(
        { processCode, updates: Object.keys(updates) },
        'Process updated from Follow-Up sheet',
      );
    }

    return {
      updated: true,
      message: `${Object.keys(updates).length} campo(s) atualizado(s)`,
      comparison,
      updatedFields: Object.keys(updates),
    };
  },

  async getLiDeadlines() {
    const results = await db
      .select({
        processId: importProcesses.id,
        processCode: importProcesses.processCode,
        brand: importProcesses.brand,
        status: importProcesses.status,
        shipmentDate: importProcesses.shipmentDate,
        liDeadline: sql<string>`${importProcesses.shipmentDate}::date + 13`,
        // `CURRENT_DATE` e o dia em UTC; das 21h a meia-noite no Brasil ele ja
        // virou, e o "dias restantes" da tela de prazos de LI mostrava um dia a
        // menos.
        daysRemaining: sql<number>`${importProcesses.shipmentDate}::date + 13 - ${sql.raw(SQL_HOJE_LOCAL)}`,
        liSubmittedAt: followUpTracking.liSubmittedAt,
        liApprovedAt: followUpTracking.liApprovedAt,
      })
      .from(importProcesses)
      .innerJoin(followUpTracking, eq(followUpTracking.processId, importProcesses.id))
      .where(
        and(eq(importProcesses.hasLiItems, true), sql`${importProcesses.shipmentDate} IS NOT NULL`),
      );

    return results;
  },
};
