import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import {
  importProcesses,
  sydlePurchasePayments,
  sydleSyncRuns,
} from '../../shared/database/schema.js';
import { auditService } from '../audit/service.js';
import { alertService } from '../alerts/service.js';
import { logger } from '../../shared/utils/logger.js';
import { SydleClient, getSydleConfigStatus } from './client.js';
import { normalizeSydlePayment, type NormalizedSydlePayment } from './normalizer.js';
import type { SydleReportQuery } from './schema.js';

type SyncTrigger = 'cron' | 'manual';
type MatchStatus = 'matched' | 'ambiguous' | 'unmatched';

interface ProcessCandidate {
  id: number;
  processCode: string;
  purchaseRef: string | null;
  brand: string;
  exporterName: string | null;
  totalFobValue: string | null;
  aiExtractedData: unknown;
}

interface MatchResult {
  processId: number | null;
  matchStatus: MatchStatus;
  matchScore: number | null;
  matchReason: string;
}

const SYDLE_CURSOR_OVERLAP_MS = 5 * 60 * 1000;
const CSV_EXPORT_PAGE_SIZE = 200;
const SYDLE_MATCH_THRESHOLD = 0.7;

function toDate(value: unknown): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toDecimalString(value: number | null | undefined, scale = 2): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return value.toFixed(scale);
}

function dateOnly(value: Date | string | null): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

function extractAiString(data: unknown, keys: string[]): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const obj = data as Record<string, unknown>;
  for (const key of keys) {
    const value = obj[key];
    if (value === null || value === undefined || value === '') continue;
    if (typeof value === 'object' && value && 'value' in value) {
      const nested = (value as Record<string, unknown>).value;
      if (nested) return String(nested);
    }
    return String(value);
  }
  return null;
}

function buildWhere(filters: SydleReportQuery, includeSearch = true) {
  const conditions = [];
  if (filters.processCode)
    conditions.push(ilike(sydlePurchasePayments.processCode, `%${filters.processCode}%`));
  if (filters.supplier)
    conditions.push(ilike(sydlePurchasePayments.supplierName, `%${filters.supplier}%`));
  if (filters.brand) conditions.push(eq(sydlePurchasePayments.brand, filters.brand));
  if (filters.paymentStatus) {
    conditions.push(eq(sydlePurchasePayments.paymentStatus, filters.paymentStatus));
  }
  if (filters.paymentType)
    conditions.push(eq(sydlePurchasePayments.paymentType, filters.paymentType));
  if (filters.matchStatus)
    conditions.push(eq(sydlePurchasePayments.matchStatus, filters.matchStatus));
  if (filters.dueFrom) conditions.push(gte(sydlePurchasePayments.dueDate, filters.dueFrom));
  if (filters.dueTo) conditions.push(lte(sydlePurchasePayments.dueDate, filters.dueTo));
  if (filters.updatedFrom) {
    conditions.push(
      gte(sydlePurchasePayments.sourceUpdatedAt, new Date(`${filters.updatedFrom}T00:00:00Z`)),
    );
  }
  if (filters.updatedTo) {
    conditions.push(
      lte(sydlePurchasePayments.sourceUpdatedAt, new Date(`${filters.updatedTo}T23:59:59Z`)),
    );
  }
  if (filters.search && includeSearch) {
    const pattern = `%${filters.search}%`;
    conditions.push(
      or(
        ilike(sydlePurchasePayments.processCode, pattern),
        ilike(sydlePurchasePayments.purchaseRef, pattern),
        ilike(sydlePurchasePayments.purchaseOrder, pattern),
        ilike(sydlePurchasePayments.proformaNumber, pattern),
        ilike(sydlePurchasePayments.invoiceNumber, pattern),
        ilike(sydlePurchasePayments.supplierName, pattern),
      )!,
    );
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}

function rowHash(row: unknown): string {
  return JSON.stringify(row, (_key, value) =>
    value instanceof Date ? value.toISOString() : value,
  );
}

function sanitizeForCsv(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

function csvLine(values: unknown[]): string {
  return values.map(sanitizeForCsv).join(',');
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export const sydleService = {
  getConfigStatus() {
    return getSydleConfigStatus();
  },

  async sync(trigger: SyncTrigger, userId: number | null = null) {
    const configStatus = getSydleConfigStatus();
    const started = new Date();
    const [run] = await db
      .insert(sydleSyncRuns)
      .values({
        status: 'running',
        trigger,
        startedAt: started,
        metadata: { config: configStatus },
      })
      .returning();

    if (!configStatus.configured) {
      return this.completeRun(run.id, started, {
        status: 'skipped',
        cursorFrom: null,
        cursorTo: null,
        fetched: 0,
        created: 0,
        updated: 0,
        unchanged: 0,
        matched: 0,
        unmatched: 0,
        errors: 0,
        errorMessage: null,
        metadata: {
          skippedReason: 'sydle_not_configured',
          missing: configStatus.missing,
        },
      });
    }

    const lock = await this.tryAcquireSyncLock();
    if (!lock.acquired) {
      return this.completeRun(run.id, started, {
        status: 'skipped',
        cursorFrom: null,
        cursorTo: null,
        fetched: 0,
        created: 0,
        updated: 0,
        unchanged: 0,
        matched: 0,
        unmatched: 0,
        errors: 0,
        errorMessage: null,
        metadata: { skippedReason: 'sync_already_running' },
      });
    }

    try {
      const previousCursor = await this.resolveLastCursor();
      const cursorFrom = this.applyCursorOverlap(previousCursor);
      const client = new SydleClient();
      const fetched = await client.fetchPayments(cursorFrom);
      const normalized = fetched.records.map((record) => normalizeSydlePayment(record));
      const cursorTo = this.resolveCursorTo(previousCursor, normalized, fetched.cursorTo);
      const result = await this.upsertPayments(normalized);

      const completed = await this.completeRun(run.id, started, {
        status: result.errors > 0 ? 'partial' : 'success',
        cursorFrom,
        cursorTo,
        fetched: normalized.length,
        ...result,
        errorMessage: null,
        metadata: {
          ...fetched.metadata,
          previousCursor: previousCursor?.toISOString() ?? null,
          cursorOverlapMs: SYDLE_CURSOR_OVERLAP_MS,
          cursorSource: cursorTo ? 'source_updated_at' : 'none',
        },
      });

      auditService.log(userId, 'sydle_sync', 'sydle', run.id, completed, null);

      if (trigger === 'manual') {
        alertService
          .create({
            severity: result.errors > 0 ? 'warning' : 'info',
            title: 'SYDLE sincronizada',
            message: `${normalized.length} registros consultados, ${result.created} criados, ${result.updated} atualizados, ${result.matched} conciliados.`,
          })
          .catch((err) => logger.error({ err }, 'Failed to create SYDLE sync alert'));
      }

      return completed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error }, 'SYDLE sync failed');
      const completed = await this.completeRun(run.id, started, {
        status: 'failed',
        cursorFrom: null,
        cursorTo: null,
        fetched: 0,
        created: 0,
        updated: 0,
        unchanged: 0,
        matched: 0,
        unmatched: 0,
        errors: 1,
        errorMessage: message,
        metadata: { failure: message },
      });
      auditService.log(userId, 'sydle_sync_failed', 'sydle', run.id, { message }, null);
      throw Object.assign(new Error(message), { syncRun: completed });
    } finally {
      lock.release();
    }
  },

  async tryAcquireSyncLock(): Promise<{ acquired: boolean; release: () => void }> {
    const result = await db.execute(
      sql`SELECT pg_try_advisory_lock(hashtext('sydle_purchase_payments_sync')) AS acquired`,
    );
    const rows = Array.isArray(result) ? result : ((result as any).rows ?? []);
    const acquired = Boolean(rows[0]?.acquired);
    return {
      acquired,
      release: () => {
        if (!acquired) return;
        void db
          .execute(sql`SELECT pg_advisory_unlock(hashtext('sydle_purchase_payments_sync'))`)
          .catch((err) => logger.warn({ err }, 'Failed to release SYDLE advisory lock'));
      },
    };
  },

  async resolveLastCursor(): Promise<Date | null> {
    const [last] = await db
      .select({ cursorTo: sydleSyncRuns.cursorTo })
      .from(sydleSyncRuns)
      .where(and(eq(sydleSyncRuns.status, 'success'), isNotNull(sydleSyncRuns.cursorTo)))
      .orderBy(desc(sydleSyncRuns.cursorTo))
      .limit(1);

    return toDate(last?.cursorTo);
  },

  applyCursorOverlap(cursor: Date | null): Date | null {
    if (!cursor) return null;
    return new Date(cursor.getTime() - SYDLE_CURSOR_OVERLAP_MS);
  },

  resolveCursorTo(
    previousCursor: Date | null,
    records: Pick<NormalizedSydlePayment, 'sourceUpdatedAt'>[],
    fetchedCursor: Date | null = null,
  ): Date | null {
    let cursor = previousCursor;
    for (const record of records) {
      if (record.sourceUpdatedAt && (!cursor || record.sourceUpdatedAt > cursor)) {
        cursor = record.sourceUpdatedAt;
      }
    }
    if (fetchedCursor && (!cursor || fetchedCursor > cursor)) {
      cursor = fetchedCursor;
    }
    return cursor;
  },

  async completeRun(
    runId: number,
    started: Date,
    data: {
      status: string;
      cursorFrom: Date | null;
      cursorTo: Date | null;
      fetched: number;
      created: number;
      updated: number;
      unchanged: number;
      matched: number;
      unmatched: number;
      errors: number;
      errorMessage: string | null;
      metadata: Record<string, unknown>;
    },
  ) {
    const completedAt = new Date();
    const [updated] = await db
      .update(sydleSyncRuns)
      .set({
        status: data.status,
        completedAt,
        duration: completedAt.getTime() - started.getTime(),
        cursorFrom: data.cursorFrom,
        cursorTo: data.cursorTo,
        fetched: data.fetched,
        created: data.created,
        updated: data.updated,
        unchanged: data.unchanged,
        matched: data.matched,
        unmatched: data.unmatched,
        errors: data.errors,
        errorMessage: data.errorMessage,
        metadata: data.metadata,
      })
      .where(eq(sydleSyncRuns.id, runId))
      .returning();

    return updated;
  },

  async upsertPayments(records: NormalizedSydlePayment[]) {
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let matched = 0;
    let unmatched = 0;
    let errors = 0;

    for (const record of records) {
      try {
        const match = await this.matchProcess(record);
        if (match.matchStatus === 'matched') matched += 1;
        else unmatched += 1;

        const values = {
          externalId: record.externalId,
          sourceSystem: 'sydle',
          processId: match.processId,
          matchStatus: match.matchStatus,
          matchScore: toDecimalString(match.matchScore, 4),
          matchReason: match.matchReason,
          processCode: record.processCode,
          purchaseRef: record.purchaseRef,
          purchaseOrder: record.purchaseOrder,
          proformaNumber: record.proformaNumber,
          invoiceNumber: record.invoiceNumber,
          supplierName: record.supplierName,
          brand: record.brand,
          currency: record.currency,
          purchaseAmount: toDecimalString(record.purchaseAmount),
          paidAmount: toDecimalString(record.paidAmount),
          openAmount: toDecimalString(record.openAmount),
          paymentType: record.paymentType,
          paymentStatus: record.paymentStatus,
          dueDate: record.dueDate,
          paidAt: record.paidAt,
          scheduledAt: record.scheduledAt,
          exchangeRate: toDecimalString(record.exchangeRate, 6),
          amountBrl: toDecimalString(record.amountBrl),
          bankName: record.bankName,
          contractNumber: record.contractNumber,
          remittanceId: record.remittanceId,
          sourceUpdatedAt: record.sourceUpdatedAt,
          rawPayload: record.rawPayload,
          syncedAt: new Date(),
          updatedAt: new Date(),
        };

        const [existing] = await db
          .select()
          .from(sydlePurchasePayments)
          .where(eq(sydlePurchasePayments.externalId, record.externalId))
          .limit(1);

        if (!existing) {
          await db.insert(sydlePurchasePayments).values(values);
          created += 1;
          continue;
        }

        const before = rowHash({
          ...existing,
          syncedAt: undefined,
          createdAt: undefined,
          updatedAt: undefined,
        });
        const after = rowHash({
          ...existing,
          ...values,
          syncedAt: undefined,
          createdAt: undefined,
          updatedAt: undefined,
        });

        if (before === after) {
          unchanged += 1;
          continue;
        }

        await db
          .update(sydlePurchasePayments)
          .set(values)
          .where(eq(sydlePurchasePayments.externalId, record.externalId));
        updated += 1;
      } catch (error) {
        errors += 1;
        logger.error({ error, externalId: record.externalId }, 'Failed to upsert SYDLE payment');
      }
    }

    return { created, updated, unchanged, matched, unmatched, errors };
  },

  async matchProcess(record: NormalizedSydlePayment): Promise<MatchResult> {
    const candidates: ProcessCandidate[] = [];

    if (record.processCode) {
      const rows = await db
        .select()
        .from(importProcesses)
        .where(eq(importProcesses.processCode, record.processCode))
        .limit(2);
      candidates.push(...(rows as ProcessCandidate[]));
      if (rows.length === 1) {
        return {
          processId: rows[0].id,
          matchStatus: 'matched',
          matchScore: 1,
          matchReason: 'process_code',
        };
      }
      if (rows.length > 1) {
        return {
          processId: null,
          matchStatus: 'ambiguous',
          matchScore: 0.5,
          matchReason: 'process_code_multiple_matches',
        };
      }
    }

    const lookupValues = [
      record.purchaseRef,
      record.purchaseOrder,
      record.proformaNumber,
      record.invoiceNumber,
    ].filter((value): value is string => Boolean(value));

    if (lookupValues.length) {
      const aiLookupConditions = lookupValues.map((value) => {
        const pattern = `%${escapeLikePattern(value)}%`;
        return sql`${importProcesses.aiExtractedData}::text ILIKE ${pattern} ESCAPE ${'\\'}`;
      });
      const rows = await db
        .select()
        .from(importProcesses)
        .where(
          or(
            inArray(importProcesses.purchaseRef, lookupValues),
            ...aiLookupConditions,
          ),
        )
        .limit(10);
      candidates.push(...(rows as ProcessCandidate[]));
    }

    const scored = new Map<number, { row: ProcessCandidate; score: number; reasons: string[] }>();
    for (const row of candidates) {
      const current = scored.get(row.id) ?? { row, score: 0, reasons: [] };

      if (record.purchaseRef && row.purchaseRef === record.purchaseRef) {
        current.score += 0.8;
        current.reasons.push('purchase_ref');
      }
      if (record.brand && normalizeText(row.brand) === normalizeText(record.brand)) {
        current.score += 0.15;
        current.reasons.push('brand');
      }
      if (
        record.supplierName &&
        normalizeText(row.exporterName).includes(normalizeText(record.supplierName))
      ) {
        current.score += 0.2;
        current.reasons.push('supplier');
      }

      const purchaseOrder = extractAiString(row.aiExtractedData, [
        'purchaseOrder',
        'poNumber',
        'pedidoCompra',
        'ordemCompra',
      ]);
      if (
        record.purchaseOrder &&
        purchaseOrder &&
        normalizeText(purchaseOrder) === normalizeText(record.purchaseOrder)
      ) {
        current.score += 0.45;
        current.reasons.push('purchase_order');
      }

      const proforma = extractAiString(row.aiExtractedData, [
        'proformaNumber',
        'piNumber',
        'numeroPi',
        'proformaInvoice',
      ]);
      if (
        record.proformaNumber &&
        proforma &&
        normalizeText(proforma) === normalizeText(record.proformaNumber)
      ) {
        current.score += 0.45;
        current.reasons.push('proforma');
      }

      const invoice = extractAiString(row.aiExtractedData, ['invoiceNumber', 'ciNumber']);
      if (
        record.invoiceNumber &&
        invoice &&
        normalizeText(invoice) === normalizeText(record.invoiceNumber)
      ) {
        current.score += 0.45;
        current.reasons.push('invoice');
      }

      const fob = toNumber(row.totalFobValue);
      if (
        fob !== null &&
        record.purchaseAmount !== null &&
        Math.abs(fob - record.purchaseAmount) <= 1
      ) {
        current.score += 0.2;
        current.reasons.push('amount');
      }

      scored.set(row.id, current);
    }

    const ranked = [...scored.values()].sort((a, b) => b.score - a.score);
    const best = ranked[0];
    if (!best || best.score < SYDLE_MATCH_THRESHOLD) {
      return {
        processId: null,
        matchStatus: 'unmatched',
        matchScore: best?.score ?? null,
        matchReason: best?.reasons.join(',') || 'no_confident_match',
      };
    }
    if (ranked[1] && Math.abs(best.score - ranked[1].score) < 0.1) {
      return {
        processId: null,
        matchStatus: 'ambiguous',
        matchScore: best.score,
        matchReason: `ambiguous:${best.reasons.join(',')}`,
      };
    }

    return {
      processId: best.row.id,
      matchStatus: 'matched',
      matchScore: best.score,
      matchReason: best.reasons.join(','),
    };
  },

  async list(filters: SydleReportQuery) {
    const where = buildWhere(filters);
    const sortMap = {
      dueDate: sydlePurchasePayments.dueDate,
      sourceUpdatedAt: sydlePurchasePayments.sourceUpdatedAt,
      purchaseAmount: sydlePurchasePayments.purchaseAmount,
      paidAmount: sydlePurchasePayments.paidAmount,
      openAmount: sydlePurchasePayments.openAmount,
      supplierName: sydlePurchasePayments.supplierName,
    } as const;
    const sort = filters.sortOrder === 'desc' ? desc : asc;
    const offset = (filters.page - 1) * filters.limit;

    const [data, [countRow]] = await Promise.all([
      db
        .select({
          id: sydlePurchasePayments.id,
          externalId: sydlePurchasePayments.externalId,
          processId: sydlePurchasePayments.processId,
          matchStatus: sydlePurchasePayments.matchStatus,
          matchScore: sydlePurchasePayments.matchScore,
          matchReason: sydlePurchasePayments.matchReason,
          processCode: sydlePurchasePayments.processCode,
          purchaseRef: sydlePurchasePayments.purchaseRef,
          purchaseOrder: sydlePurchasePayments.purchaseOrder,
          proformaNumber: sydlePurchasePayments.proformaNumber,
          invoiceNumber: sydlePurchasePayments.invoiceNumber,
          supplierName: sydlePurchasePayments.supplierName,
          brand: sydlePurchasePayments.brand,
          currency: sydlePurchasePayments.currency,
          purchaseAmount: sydlePurchasePayments.purchaseAmount,
          paidAmount: sydlePurchasePayments.paidAmount,
          openAmount: sydlePurchasePayments.openAmount,
          paymentType: sydlePurchasePayments.paymentType,
          paymentStatus: sydlePurchasePayments.paymentStatus,
          dueDate: sydlePurchasePayments.dueDate,
          paidAt: sydlePurchasePayments.paidAt,
          scheduledAt: sydlePurchasePayments.scheduledAt,
          exchangeRate: sydlePurchasePayments.exchangeRate,
          amountBrl: sydlePurchasePayments.amountBrl,
          bankName: sydlePurchasePayments.bankName,
          contractNumber: sydlePurchasePayments.contractNumber,
          remittanceId: sydlePurchasePayments.remittanceId,
          sourceUpdatedAt: sydlePurchasePayments.sourceUpdatedAt,
          syncedAt: sydlePurchasePayments.syncedAt,
          updatedAt: sydlePurchasePayments.updatedAt,
          portalProcessCode: importProcesses.processCode,
          portalBrand: importProcesses.brand,
        })
        .from(sydlePurchasePayments)
        .leftJoin(importProcesses, eq(sydlePurchasePayments.processId, importProcesses.id))
        .where(where)
        .orderBy(sort(sortMap[filters.sortBy]), sort(sydlePurchasePayments.id))
        .limit(filters.limit)
        .offset(offset),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(sydlePurchasePayments)
        .where(where),
    ]);

    return { data, total: Number(countRow?.total ?? 0), page: filters.page, limit: filters.limit };
  },

  async summary(filters: SydleReportQuery) {
    const where = buildWhere(filters);
    const [row] = await db
      .select({
        totalPurchaseUsd: sql<string>`coalesce(sum(case when ${sydlePurchasePayments.currency} = 'USD' then ${sydlePurchasePayments.purchaseAmount} else 0 end), 0)`,
        totalPaidUsd: sql<string>`coalesce(sum(case when ${sydlePurchasePayments.currency} = 'USD' then ${sydlePurchasePayments.paidAmount} else 0 end), 0)`,
        totalOpenUsd: sql<string>`coalesce(sum(case when ${sydlePurchasePayments.currency} = 'USD' then ${sydlePurchasePayments.openAmount} else 0 end), 0)`,
        totalBrl: sql<string>`coalesce(sum(${sydlePurchasePayments.amountBrl}), 0)`,
        records: sql<number>`count(*)::int`,
        matched: sql<number>`count(*) filter (where ${sydlePurchasePayments.matchStatus} = 'matched')::int`,
        unmatched: sql<number>`count(*) filter (where ${sydlePurchasePayments.matchStatus} <> 'matched')::int`,
        overdue: sql<number>`count(*) filter (where ${sydlePurchasePayments.paymentStatus} = 'overdue' or (${sydlePurchasePayments.paymentStatus} in ('open', 'scheduled') and ${sydlePurchasePayments.dueDate} < current_date))::int`,
        dueSoon: sql<number>`count(*) filter (where ${sydlePurchasePayments.paymentStatus} in ('open', 'scheduled') and ${sydlePurchasePayments.dueDate} between current_date and current_date + interval '7 days')::int`,
        paid: sql<number>`count(*) filter (where ${sydlePurchasePayments.paymentStatus} = 'paid')::int`,
      })
      .from(sydlePurchasePayments)
      .where(where);

    const [lastRun] = await db
      .select()
      .from(sydleSyncRuns)
      .orderBy(desc(sydleSyncRuns.startedAt))
      .limit(1);

    return {
      totalPurchaseUsd: Number(row?.totalPurchaseUsd ?? 0),
      totalPaidUsd: Number(row?.totalPaidUsd ?? 0),
      totalOpenUsd: Number(row?.totalOpenUsd ?? 0),
      totalBrl: Number(row?.totalBrl ?? 0),
      records: Number(row?.records ?? 0),
      matched: Number(row?.matched ?? 0),
      unmatched: Number(row?.unmatched ?? 0),
      overdue: Number(row?.overdue ?? 0),
      dueSoon: Number(row?.dueSoon ?? 0),
      paid: Number(row?.paid ?? 0),
      config: this.getConfigStatus(),
      lastRun,
    };
  },

  async getSyncRuns(limit = 20) {
    return db.select().from(sydleSyncRuns).orderBy(desc(sydleSyncRuns.startedAt)).limit(limit);
  },

  async exportCsv(filters: SydleReportQuery): Promise<string> {
    const firstPage = await this.list({ ...filters, page: 1, limit: CSV_EXPORT_PAGE_SIZE });
    const rows = [...firstPage.data];
    let page = 2;

    while (rows.length < firstPage.total) {
      const nextPage = await this.list({ ...filters, page, limit: CSV_EXPORT_PAGE_SIZE });
      if (nextPage.data.length === 0) break;
      rows.push(...nextPage.data);
      page += 1;
    }

    const header = [
      'Processo',
      'Compra',
      'PO',
      'PI',
      'Invoice',
      'Fornecedor',
      'Marca',
      'Moeda',
      'Valor Compra',
      'Valor Pago',
      'Saldo Aberto',
      'Tipo Pagamento',
      'Status Pagamento',
      'Vencimento',
      'Pago Em',
      'Taxa Cambio',
      'Valor BRL',
      'Match Portal',
      'Motivo Match',
      'Atualizado Na SYDLE',
      'Sincronizado Em',
    ];

    return [
      csvLine(header),
      ...rows.map((row) =>
        csvLine([
          row.processCode || row.portalProcessCode || '',
          row.purchaseRef || '',
          row.purchaseOrder || '',
          row.proformaNumber || '',
          row.invoiceNumber || '',
          row.supplierName || '',
          row.brand || row.portalBrand || '',
          row.currency,
          row.purchaseAmount || '',
          row.paidAmount || '',
          row.openAmount || '',
          row.paymentType,
          row.paymentStatus,
          dateOnly(row.dueDate),
          dateOnly(row.paidAt),
          row.exchangeRate || '',
          row.amountBrl || '',
          row.matchStatus,
          row.matchReason || '',
          dateOnly(row.sourceUpdatedAt),
          dateOnly(row.syncedAt),
        ]),
      ),
    ].join('\n');
  },
};
