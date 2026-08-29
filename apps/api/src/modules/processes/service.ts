import { eq, desc, and, sql, count } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import {
  importProcesses,
  documents,
  followUpTracking,
  processEvents,
  processCustomStages,
  processOperationalRecords,
  users,
} from '../../shared/database/schema.js';
import type {
  CreateProcessInput,
  UpdateProcessInput,
  ProcessFilter,
  CreateFromPreConsInput,
  CreateCustomStageInput,
  UpdateCustomStageInput,
  CreateOperationalRecordInput,
  UpdateOperationalRecordInput,
  UpdateDraftBlChecklistInput,
} from './schema.js';
import { DRAFT_BL_CHECK_KEYS, REOPEN_REASON_MIN_LENGTH, reopenReasonSchema } from './schema.js';
import { auditService } from '../audit/service.js';
import { assertTransition, isReopenTransition } from '../../shared/state-machine/process-states.js';
import type { ProcessStatus } from '../../shared/state-machine/process-states.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../shared/errors/index.js';
import { recordProcessEvent } from '../../shared/utils/process-events.js';
import { logger } from '../../shared/utils/logger.js';
import { deriveLogisticStatus, isForwardTransition } from './logistic-auto-advance.js';
import { localDayStartUtc, localDayEndExclusiveUtc } from '../../shared/utils/dates.js';

// Colunas timestamp() (modo Date) recebem strings dos schemas: converte com
// validação — '' limpa o campo; valor não parseável vira erro 400 claro.
function parseTimestampInput(field: string, value: string | null | undefined): Date | null {
  if (value == null || !value.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`Data inválida em ${field}: ${value}`);
  }
  return parsed;
}

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
    // A data vem de um calendario local; a coluna guarda UTC. Converter o dia
    // local no intervalo UTC equivalente evita perder as 3 horas finais do dia.
    const startAt = filter.startDate ? localDayStartUtc(filter.startDate) : null;
    if (startAt) {
      conditions.push(sql`${importProcesses.createdAt} >= ${startAt.toISOString()}`);
    }
    const endAt = filter.endDate ? localDayEndExclusiveUtc(filter.endDate) : null;
    if (endAt) {
      conditions.push(sql`${importProcesses.createdAt} < ${endAt.toISOString()}`);
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (filter.page - 1) * filter.limit;

    const [data, [{ total }]] = await Promise.all([
      db
        .select()
        .from(importProcesses)
        .where(where)
        // createdAt nao e unico (os 117 processos da planilha foram importados
        // no mesmo instante); sem desempate estavel a paginacao repete e perde
        // linhas entre paginas.
        .orderBy(desc(importProcesses.createdAt), desc(importProcesses.id))
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

  async getDraftBlChecklist(processId: number) {
    const [process] = await db
      .select({ id: importProcesses.id })
      .from(importProcesses)
      .where(eq(importProcesses.id, processId))
      .limit(1);
    if (!process) throw new NotFoundError('Processo', processId);

    const events = await db
      .select({
        id: processEvents.id,
        metadata: processEvents.metadata,
        createdBy: processEvents.createdBy,
        createdAt: processEvents.createdAt,
        userName: users.name,
      })
      .from(processEvents)
      .leftJoin(users, eq(processEvents.createdBy, users.id))
      .where(
        and(
          eq(processEvents.processId, processId),
          eq(processEvents.eventType, 'draft_bl_checklist_changed'),
        ),
      )
      .orderBy(desc(processEvents.createdAt), desc(processEvents.id));

    const allowedKeys = new Set<string>(DRAFT_BL_CHECK_KEYS);
    const state: Record<
      string,
      {
        checked: boolean;
        timestamp: string | null;
        checkedBy: number | null;
        checkedByName: string | null;
      }
    > = Object.fromEntries(
      DRAFT_BL_CHECK_KEYS.map((key) => [
        key,
        { checked: false, timestamp: null, checkedBy: null, checkedByName: null },
      ]),
    );
    const resolved = new Set<string>();

    for (const event of events) {
      const metadata = (event.metadata ?? {}) as Record<string, unknown>;
      const key = typeof metadata.key === 'string' ? metadata.key : null;
      if (!key || !allowedKeys.has(key) || resolved.has(key)) continue;

      const checked = metadata.checked === true;
      const metadataTimestamp = typeof metadata.timestamp === 'string' ? metadata.timestamp : null;
      const createdAt = event.createdAt instanceof Date ? event.createdAt.toISOString() : null;
      state[key] = {
        checked,
        timestamp: checked ? (metadataTimestamp ?? createdAt) : null,
        checkedBy: checked ? (event.createdBy ?? null) : null,
        checkedByName: checked
          ? typeof metadata.checkedByName === 'string'
            ? metadata.checkedByName
            : (event.userName ?? null)
          : null,
      };
      resolved.add(key);
    }

    return state;
  },

  async updateDraftBlChecklist(
    processId: number,
    input: UpdateDraftBlChecklistInput,
    userId: number | null = null,
  ) {
    await this.assertNotLocked(processId);
    const [process] = await db
      .select({ id: importProcesses.id })
      .from(importProcesses)
      .where(eq(importProcesses.id, processId))
      .limit(1);
    if (!process) throw new NotFoundError('Processo', processId);

    const [user] = userId
      ? await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1)
      : [undefined];
    const timestamp = new Date();

    await db.insert(processEvents).values({
      processId,
      eventType: 'draft_bl_checklist_changed',
      title: `Checklist Draft BL: ${input.key} ${input.checked ? 'validado' : 'reaberto'}`,
      description: input.checked
        ? 'Item do checklist do Draft BL validado por operador.'
        : 'Validacao do item do checklist do Draft BL removida por operador.',
      metadata: {
        key: input.key,
        checked: input.checked,
        timestamp: timestamp.toISOString(),
        checkedByName: user?.name ?? null,
      },
      createdBy: userId,
    });

    await auditService.log(
      userId,
      'draft_bl_checklist_update',
      'process',
      processId,
      { key: input.key, checked: input.checked },
      null,
    );

    return {
      key: input.key,
      checked: input.checked,
      timestamp: input.checked ? timestamp.toISOString() : null,
      checkedBy: input.checked ? userId : null,
      checkedByName: input.checked ? (user?.name ?? null) : null,
    };
  },

  async listCustomStages(processId: number) {
    return db
      .select()
      .from(processCustomStages)
      .where(eq(processCustomStages.processId, processId))
      .orderBy(processCustomStages.position, processCustomStages.createdAt);
  },

  async createCustomStage(
    processId: number,
    input: CreateCustomStageInput,
    userId: number | null = null,
  ) {
    await this.assertNotLocked(processId);
    const [process] = await db
      .select({ id: importProcesses.id })
      .from(importProcesses)
      .where(eq(importProcesses.id, processId))
      .limit(1);
    if (!process) throw new NotFoundError('Processo', processId);

    const [stage] = await db
      .insert(processCustomStages)
      .values({
        processId,
        label: input.label,
        position: input.position,
        completedAt: parseTimestampInput('completedAt', input.completedAt),
        notes: input.notes ?? null,
        createdBy: userId,
      })
      .returning();

    await auditService.log(
      userId,
      'create_custom_stage',
      'process',
      processId,
      {
        stageId: stage.id,
        label: stage.label,
        position: stage.position,
      },
      null,
    );
    await recordProcessEvent(
      processId,
      {
        eventType: 'custom_stage_created',
        title: `Etapa especifica adicionada: ${stage.label}`,
        metadata: { stageId: stage.id, position: stage.position },
      },
      userId,
    );
    return stage;
  },

  async updateCustomStage(
    processId: number,
    stageId: number,
    input: UpdateCustomStageInput,
    userId: number | null = null,
  ) {
    await this.assertNotLocked(processId);
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (input.label !== undefined) updateData.label = input.label;
    if (input.position !== undefined) updateData.position = input.position;
    if (input.completedAt !== undefined) {
      updateData.completedAt = parseTimestampInput('completedAt', input.completedAt);
    }
    if (input.notes !== undefined) updateData.notes = input.notes ?? null;

    const [stage] = await db
      .update(processCustomStages)
      .set(updateData)
      .where(and(eq(processCustomStages.id, stageId), eq(processCustomStages.processId, processId)))
      .returning();
    if (!stage) throw new NotFoundError('Etapa', stageId);

    await auditService.log(
      userId,
      'update_custom_stage',
      'process',
      processId,
      {
        stageId,
        fields: Object.keys(input),
      },
      null,
    );
    return stage;
  },

  async deleteCustomStage(processId: number, stageId: number, userId: number | null = null) {
    await this.assertNotLocked(processId);
    const [stage] = await db
      .delete(processCustomStages)
      .where(and(eq(processCustomStages.id, stageId), eq(processCustomStages.processId, processId)))
      .returning();
    if (!stage) throw new NotFoundError('Etapa', stageId);
    await auditService.log(
      userId,
      'delete_custom_stage',
      'process',
      processId,
      {
        stageId,
        label: stage.label,
      },
      null,
    );
    return { deleted: true };
  },

  async listOperationalRecords(processId: number) {
    return db
      .select()
      .from(processOperationalRecords)
      .where(eq(processOperationalRecords.processId, processId))
      .orderBy(desc(processOperationalRecords.createdAt), desc(processOperationalRecords.id));
  },

  async createOperationalRecord(
    processId: number,
    input: CreateOperationalRecordInput,
    userId: number | null = null,
  ) {
    await this.assertNotLocked(processId);
    const [process] = await db
      .select({ id: importProcesses.id })
      .from(importProcesses)
      .where(eq(importProcesses.id, processId))
      .limit(1);
    if (!process) throw new NotFoundError('Processo', processId);

    const [record] = await db
      .insert(processOperationalRecords)
      .values({
        processId,
        recordKind: input.recordKind,
        recordType: input.recordType,
        quantity: input.quantity ?? null,
        amount: input.amount,
        currency: input.currency || 'BRL',
        notes: input.notes ?? null,
        createdBy: userId,
      })
      .returning();

    await auditService.log(
      userId,
      'create_operational_record',
      'process',
      processId,
      {
        recordId: record.id,
        recordKind: record.recordKind,
        recordType: record.recordType,
      },
      null,
    );
    return record;
  },

  async updateOperationalRecord(
    processId: number,
    recordId: number,
    input: UpdateOperationalRecordInput,
    userId: number | null = null,
  ) {
    await this.assertNotLocked(processId);
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (input.recordKind !== undefined) updateData.recordKind = input.recordKind;
    if (input.recordType !== undefined) updateData.recordType = input.recordType;
    if (input.quantity !== undefined) updateData.quantity = input.quantity ?? null;
    if (input.amount !== undefined) updateData.amount = input.amount;
    if (input.currency !== undefined) updateData.currency = input.currency || 'BRL';
    if (input.notes !== undefined) updateData.notes = input.notes ?? null;

    const [record] = await db
      .update(processOperationalRecords)
      .set(updateData)
      .where(
        and(
          eq(processOperationalRecords.id, recordId),
          eq(processOperationalRecords.processId, processId),
        ),
      )
      .returning();
    if (!record) throw new NotFoundError('Registro', recordId);
    await auditService.log(
      userId,
      'update_operational_record',
      'process',
      processId,
      {
        recordId,
        fields: Object.keys(input),
      },
      null,
    );
    return record;
  },

  async deleteOperationalRecord(processId: number, recordId: number, userId: number | null = null) {
    await this.assertNotLocked(processId);
    const [record] = await db
      .delete(processOperationalRecords)
      .where(
        and(
          eq(processOperationalRecords.id, recordId),
          eq(processOperationalRecords.processId, processId),
        ),
      )
      .returning();
    if (!record) throw new NotFoundError('Registro', recordId);
    await auditService.log(
      userId,
      'delete_operational_record',
      'process',
      processId,
      {
        recordId,
        recordKind: record.recordKind,
      },
      null,
    );
    return { deleted: true };
  },

  async create(input: CreateProcessInput, userId: number) {
    const process = await db.transaction(async (tx) => {
      const [created] = await tx
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
          urgentNote: input.urgentNote,
          containerType: input.containerType,
          totalFobValue: input.totalFobValue,
          freightValue: input.freightValue,
          insuranceValue: input.insuranceValue,
          customsValue: input.customsValue,
          registrationDollar: input.registrationDollar,
          totalCbm: input.totalCbm,
          totalBoxes: input.totalBoxes,
          totalNetWeight: input.totalNetWeight,
          totalGrossWeight: input.totalGrossWeight,
          shipmentDate: input.shipmentDate,
          logisticStatus: 'consolidation',
          createdBy: userId,
        })
        .returning();

      await tx.insert(followUpTracking).values({
        processId: created.id,
      });

      return created;
    });

    // Audit log AFTER commit (best-effort) — must not reference an entity that
    // could be rolled back, and a logging failure must not undo the create.
    try {
      auditService.log(
        userId,
        'create',
        'process',
        process.id,
        { processCode: input.processCode },
        null,
      );
    } catch (err) {
      logger.error({ err, processId: process.id }, 'Failed to write create audit log');
    }

    return process;
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

    const espelhoSummary = getEspelhoSummary(process.aiExtractedData);
    const blData = getBlData(process.aiExtractedData);

    const [followUp] = await db
      .select()
      .from(followUpTracking)
      .where(eq(followUpTracking.processId, processId))
      .limit(1);

    const derived = deriveLogisticStatus({
      process: {
        etd:
          process.etd ??
          readString(espelhoSummary, 'etd') ??
          readString(blData, 'etd') ??
          readString(blData, 'shipmentDate') ??
          null,
        eta: process.eta ?? readString(espelhoSummary, 'eta') ?? readString(blData, 'eta') ?? null,
        shipmentDate:
          process.shipmentDate ??
          readString(espelhoSummary, 'shipmentDate') ??
          readString(espelhoSummary, 'shippedOnBoardDate') ??
          readString(blData, 'shipmentDate') ??
          readString(blData, 'etd') ??
          null,
        customsChannel: process.customsChannel ?? null,
        diNumber: process.diNumber ?? null,
        duimpNumber: process.duimpNumber ?? null,
        registeredAt: process.registeredAt ?? null,
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

    // registeredAt/customsClearanceAt são colunas timestamp() em modo Date;
    // o schema entrega strings (YYYY-MM-DD) que o driver não aceita.
    const patch: Record<string, unknown> = { ...rest };
    for (const field of ['registeredAt', 'customsClearanceAt'] as const) {
      const value = patch[field];
      if (typeof value !== 'string') continue;
      patch[field] = parseTimestampInput(field, value);
    }

    const [process] = await db
      .update(importProcesses)
      .set({
        ...patch,
        updatedAt: new Date(),
      } as Partial<typeof importProcesses.$inferInsert>)
      .where(eq(importProcesses.id, id))
      .returning();

    if (!process) throw new NotFoundError('Processo', id);
    auditService.log(userId, 'update', 'process', id, { fields: Object.keys(input) }, null);

    // Re-deriva a fase logistica quando um campo que a governa muda (Eduarda
    // 2026-06-22: editar o ETD deve mover o processo imediatamente, sem esperar
    // o cron). Idempotente: advanceLogisticStatus so avanca para frente.
    const logisticFields = [
      'etd',
      'eta',
      'shipmentDate',
      'customsChannel',
      'diNumber',
      'duimpNumber',
      'registeredAt',
      'customsClearanceAt',
      'cdArrivalAt',
    ];
    if (logisticFields.some((field) => (input as Record<string, unknown>)[field] !== undefined)) {
      try {
        await this.advanceLogisticStatus(id, userId);
      } catch (advErr) {
        logger.error({ err: advErr, id }, 'Auto-advance logistic status after update failed');
      }
    }

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

  /**
   * Guarda das transicoes de REABERTURA (`sent_to_fenicia`/`completed` ->
   * `validating`, `completed` -> `cancelled`): exige papel admin e motivo
   * escrito. Devolve o motivo ja normalizado (trim) ou `null` quando a
   * transicao e um avanco normal, que nao pede nada disso.
   */
  assertReopenAllowed(
    from: ProcessStatus,
    to: ProcessStatus,
    opts: { reason?: string | null; actorRole?: string | null },
  ): string | null {
    if (!isReopenTransition(from, to)) return null;

    if (opts.actorRole !== 'admin') {
      throw new ForbiddenError(
        `Reabrir um processo em ${from} (-> ${to}) e restrito a administradores.`,
      );
    }

    const parsed = reopenReasonSchema.safeParse(opts.reason);
    if (!parsed.success) {
      throw new ValidationError(
        `Motivo obrigatorio (minimo ${REOPEN_REASON_MIN_LENGTH} caracteres) para reabrir um processo em ${from}.`,
        [{ field: 'reason', message: parsed.error.errors[0]?.message ?? 'Motivo invalido' }],
      );
    }
    return parsed.data;
  },

  async updateStatus(
    id: number,
    status: string,
    userId: number | null = null,
    opts: { reason?: string | null; actorRole?: string | null } = {},
  ) {
    await this.assertNotLocked(id);
    const [current] = await db
      .select()
      .from(importProcesses)
      .where(eq(importProcesses.id, id))
      .limit(1);

    if (!current) throw new NotFoundError('Processo', id);

    const from = current.status as ProcessStatus;
    assertTransition(from, status as ProcessStatus);
    const reopenReason = this.assertReopenAllowed(from, status as ProcessStatus, opts);

    const [process] = await db
      .update(importProcesses)
      .set({
        status: status as (typeof importProcesses.status.enumValues)[number],
        updatedAt: new Date(),
      })
      .where(eq(importProcesses.id, id))
      .returning();

    auditService.log(
      userId,
      reopenReason ? 'status_reopen' : 'status_update',
      'process',
      id,
      reopenReason ? { status, previousStatus: from, reason: reopenReason } : { status },
      null,
    );

    // AWAIT proposital (os demais `recordProcessEvent` sao fire-and-forget): a
    // resposta 200 nao pode sair antes de a trilha da mudanca de status existir.
    // Numa reabertura o motivo registrado E a justificativa da operacao.
    await recordProcessEvent(
      id,
      {
        eventType: 'status_changed',
        title: reopenReason
          ? `Processo reaberto: ${from} → ${status}`
          : `Status alterado para ${status}`,
        description: reopenReason ?? undefined,
        metadata: {
          previousStatus: from,
          newStatus: status,
          ...(reopenReason ? { reopen: true, reason: reopenReason } : {}),
        },
      },
      userId,
    );

    return process;
  },

  async delete(
    id: number,
    userId: number | null = null,
    opts: { reason?: string | null; actorRole?: string | null } = {},
  ) {
    await this.assertNotLocked(id);
    const [current] = await db
      .select()
      .from(importProcesses)
      .where(eq(importProcesses.id, id))
      .limit(1);

    if (!current) throw new NotFoundError('Processo', id);

    const from = current.status as ProcessStatus;
    assertTransition(from, 'cancelled');
    // Cancelar um processo ja CONCLUIDO e reabertura: pede motivo e admin.
    // Cancelar um processo em andamento segue como antes (rota ja e admin-only).
    const reopenReason = this.assertReopenAllowed(from, 'cancelled', opts);

    const [process] = await db
      .update(importProcesses)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(importProcesses.id, id))
      .returning({ id: importProcesses.id });
    auditService.log(
      userId,
      'delete',
      'process',
      id,
      reopenReason ? { previousStatus: from, reason: reopenReason } : null,
      null,
    );

    // A trilha `status_changed` faltava no cancelamento: o processo saia de
    // qualquer estado para `cancelled` sem uma linha na timeline. Awaited pelo
    // mesmo motivo do updateStatus.
    await recordProcessEvent(
      id,
      {
        eventType: 'status_changed',
        title: reopenReason
          ? `Processo concluido cancelado: ${from} → cancelled`
          : 'Status alterado para cancelled',
        description: reopenReason ?? undefined,
        metadata: {
          previousStatus: from,
          newStatus: 'cancelled',
          ...(reopenReason ? { reopen: true, reason: reopenReason } : {}),
        },
      },
      userId,
    );

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

function getEspelhoSummary(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const root = value as Record<string, unknown>;
  const espelho = root.espelho;
  if (espelho && typeof espelho === 'object') {
    const summary = (espelho as Record<string, unknown>).summary;
    if (summary && typeof summary === 'object') return summary as Record<string, unknown>;
  }
  const summary = root.espelhoSummary;
  return summary && typeof summary === 'object' ? (summary as Record<string, unknown>) : null;
}

function readString(source: Record<string, unknown> | null, key: string): string | null {
  const value = source?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

// The BL (ohbl / draft_bl) carries the real shipping milestones (etd /
// shipmentDate). They live inside aiExtractedData and — until the espelho is
// auto-built — are NOT promoted to the process columns nor the espelho summary.
// Reading them here lets the logistic status advance to "in_transit" as soon as
// the BL is extracted, instead of waiting for the espelho build (Eduarda
// 2026-06-19: "já deveria ter atualizado para em trânsito porque o ETD é de
// fevereiro").
function getBlData(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const root = value as Record<string, unknown>;
  const bl = root.ohbl ?? root.draft_bl;
  return bl && typeof bl === 'object' ? (bl as Record<string, unknown>) : null;
}
