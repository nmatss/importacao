import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gte,
  ilike,
  inArray,
  isNotNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import * as XLSX from 'xlsx';
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
interface SyncOptions {
  full?: boolean;
}

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
const PDF_LINE_HEIGHT = 12;
const PDF_MARGIN_X = 28;
const PDF_MARGIN_TOP = 548;
const PDF_PAGE_WIDTH = 842;
const PDF_PAGE_HEIGHT = 595;

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

function parseDateOnly(value: Date | string | null): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseDateTime(value: Date | string | null): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? parseDateOnly(value) : parsed;
}

function formatDateBr(value: Date | string | null): string {
  const parsed = parseDateOnly(value);
  if (!parsed) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(parsed);
}

function formatDateTimeBr(value: Date | string | null): string {
  const parsed = parseDateTime(value);
  if (!parsed) return '';
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(parsed);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}

function formatCurrencyBr(value: unknown, currency = 'USD'): string {
  const numeric = toNumber(value);
  if (numeric === null) return '';
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
      .format(numeric)
      .replace(/\u00a0/g, ' ');
  } catch {
    return numeric.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
}

function formatDecimalBr(value: unknown, maximumFractionDigits = 6): string {
  const numeric = toNumber(value);
  if (numeric === null) return '';
  return numeric.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  });
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

function extractAiString(data: unknown, keys: string[]): string | null {
  const wanted = new Set(keys.map(normalizeText));

  function visit(value: unknown, depth: number): string | null {
    if (!value || depth > 6) return null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item, depth + 1);
        if (found) return found;
      }
      return null;
    }
    if (typeof value !== 'object') return null;

    const obj = value as Record<string, unknown>;
    for (const [key, nestedValue] of Object.entries(obj)) {
      if (!wanted.has(normalizeText(key))) continue;
      if (nestedValue === null || nestedValue === undefined || nestedValue === '') continue;
      if (
        typeof nestedValue === 'object' &&
        !Array.isArray(nestedValue) &&
        'value' in nestedValue
      ) {
        const confidenceValue = (nestedValue as Record<string, unknown>).value;
        if (confidenceValue !== null && confidenceValue !== undefined && confidenceValue !== '') {
          return String(confidenceValue);
        }
        continue;
      }
      if (typeof nestedValue !== 'object') return String(nestedValue);
    }

    for (const nestedValue of Object.values(obj)) {
      const found = visit(nestedValue, depth + 1);
      if (found) return found;
    }

    return null;
  }

  return visit(data, 0);
}

function buildWhere(filters: SydleReportQuery, includeSearch = true) {
  const conditions = [];
  if (filters.processCode)
    conditions.push(ilike(sydlePurchasePayments.processCode, `%${filters.processCode}%`));
  if (filters.supplier)
    conditions.push(ilike(sydlePurchasePayments.supplierName, `%${filters.supplier}%`));
  if (filters.brand) conditions.push(eq(sydlePurchasePayments.brand, filters.brand));
  if (filters.currency)
    conditions.push(eq(sydlePurchasePayments.currency, filters.currency.toUpperCase()));
  // Phase filter references the joined process — every buildWhere consumer must
  // leftJoin importProcesses (list/count/summary/breakdown all do).
  if (filters.logisticStatus)
    conditions.push(eq(importProcesses.logisticStatus, filters.logisticStatus));
  if (filters.paymentStatus) {
    conditions.push(eq(sydlePurchasePayments.paymentStatus, filters.paymentStatus));
  }
  if (filters.paymentType)
    conditions.push(eq(sydlePurchasePayments.paymentType, filters.paymentType));
  if (filters.matchStatus)
    conditions.push(eq(sydlePurchasePayments.matchStatus, filters.matchStatus));
  if (filters.dueBucket === 'overdue') {
    conditions.push(
      sql`${sydlePurchasePayments.dueDate} < current_date and ${sydlePurchasePayments.paymentStatus} in ('open', 'scheduled', 'overdue')`,
    );
  } else if (filters.dueBucket === 'due7') {
    conditions.push(
      sql`${sydlePurchasePayments.dueDate} between current_date and current_date + interval '7 days' and ${sydlePurchasePayments.paymentStatus} in ('open', 'scheduled')`,
    );
  } else if (filters.dueBucket === 'due30') {
    conditions.push(
      sql`${sydlePurchasePayments.dueDate} between current_date and current_date + interval '30 days' and ${sydlePurchasePayments.paymentStatus} in ('open', 'scheduled')`,
    );
  }
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
        ilike(sydlePurchasePayments.sydleProtocol, pattern),
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

function sanitizeForSpreadsheet(value: unknown): string | number {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? value : '';
  const raw = String(value);
  return /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
}

function pdfEscape(value: unknown): string {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[\r\n\t]+/g, ' ');
}

function truncate(value: unknown, length: number): string {
  const text = String(value ?? '');
  return text.length > length ? `${text.slice(0, Math.max(0, length - 1))}…` : text;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

// Phase labels mirror the frontend LOGISTIC_STAGES so the CSV reads the same as
// the screen ("em qual fase o processo está").
const LOGISTIC_STATUS_LABELS: Record<string, string> = {
  consolidation: 'Em Consolidacao',
  waiting_shipment: 'Ag. Embarque',
  in_transit: 'Em Transito',
  berthing: 'Em Atracacao',
  registered: 'Registrado',
  customs_inspection: 'Conf. Aduaneira',
  port_release: 'Lib. Portuaria',
  waiting_loading: 'Ag. Carregamento',
  traveling_cd: 'Em Viagem CD',
  waiting_entry: 'Ag. Entrada',
  internalized: 'Internalizado',
};

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  deposit: 'Deposit',
  deposit_in_advance: 'Deposit in Advance',
  balance: 'Balance',
  balance_before_shipment: 'Balance before Shipment',
  balance_after_shipment: 'Balance after Shipment',
  fee: 'Fee',
  refund: 'Refund',
  other: 'Other',
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  open: 'Aberto',
  scheduled: 'Agendado',
  paid: 'Pago',
  overdue: 'Vencido',
  cancelled: 'Cancelado',
  unknown: 'Desconhecido',
};

function phaseLabel(status: string | null | undefined): string {
  if (!status) return '';
  return LOGISTIC_STATUS_LABELS[status] ?? status;
}

type SydleExportRow = Awaited<ReturnType<typeof sydleService.list>>['data'][number];

const EXPORT_COLUMNS = [
  { key: 'sydleProtocol', header: 'Protocolo' },
  { key: 'process', header: 'Processo' },
  { key: 'phase', header: 'Fase Processo' },
  { key: 'purchaseOrder', header: 'PO' },
  { key: 'proformaNumber', header: 'PI' },
  { key: 'invoiceNumber', header: 'Número Invoice' },
  { key: 'supplierName', header: 'Beneficiário' },
  { key: 'brand', header: 'Marca' },
  { key: 'paymentType', header: 'Tipo de pagamento' },
  { key: 'dueDate', header: 'Data de vencimento' },
  { key: 'currency', header: 'Moeda de pagamento' },
  { key: 'purchaseAmount', header: 'Valor a Pagar' },
  { key: 'invoiceIssuedDate', header: 'Data de emissão Invoice/PI' },
  { key: 'taskCreatedAt', header: 'Data criação da tarefa' },
  { key: 'exceptionStatus', header: 'Exceção' },
  { key: 'exceptionReason', header: 'Motivo da exceção' },
  { key: 'shipmentDate', header: 'Data de embarque' },
  { key: 'paymentDeadlineAfterShipment', header: 'Prazo para pagamento pós embarque' },
  { key: 'paidAmount', header: 'Valor Pago' },
  { key: 'openAmount', header: 'Saldo Aberto' },
  { key: 'paymentStatus', header: 'Status Pagamento' },
  { key: 'paidAt', header: 'Pago Em' },
  { key: 'scheduledAt', header: 'Agendado Para' },
  { key: 'exchangeRate', header: 'Taxa Câmbio' },
  { key: 'exchangeRateSource', header: 'Origem Câmbio' },
  { key: 'amountBrl', header: 'Valor BRL' },
  { key: 'amountBrlSource', header: 'Origem BRL' },
  { key: 'bankName', header: 'Banco' },
  { key: 'contractNumber', header: 'Contrato' },
  { key: 'remittanceId', header: 'Remessa' },
  { key: 'matchStatus', header: 'Conciliação Portal' },
  { key: 'matchReason', header: 'Evidência conciliação' },
  { key: 'sourceUpdatedAt', header: 'Data da última alteração' },
  { key: 'syncedAt', header: 'Sincronizado Em' },
] as const;

type ExportColumnKey = (typeof EXPORT_COLUMNS)[number]['key'];

const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  matched: 'Conciliado',
  ambiguous: 'Ambíguo',
  unmatched: 'Sem vínculo',
};

const MATCH_REASON_LABELS: Record<string, string> = {
  process_code: 'Processo',
  process_code_multiple_matches: 'Processo com múltiplos vínculos',
  purchase_ref: 'Referência da compra',
  purchase_order: 'Pedido de compra',
  proforma: 'PI',
  invoice: 'Invoice',
  supplier: 'Beneficiário',
  brand: 'Marca',
  amount: 'Valor',
  no_confident_match: 'Sem evidência suficiente',
};

function matchReasonLabel(value: string | null | undefined): string {
  if (!value) return '';
  const ambiguous = value.startsWith('ambiguous:');
  const raw = ambiguous ? value.replace(/^ambiguous:/, '') : value;
  const labels = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => MATCH_REASON_LABELS[part] ?? part);
  if (!labels.length) return '';
  return `${ambiguous ? 'Ambíguo: ' : ''}${labels.join(' + ')}`;
}

function xlsxCurrencyFormat(currency: string | null | undefined): string {
  switch ((currency ?? '').toUpperCase()) {
    case 'BRL':
      return '"R$" #,##0.00';
    case 'USD':
      return '"US$" #,##0.00';
    case 'EUR':
      return '"€" #,##0.00';
    case 'CNY':
    case 'RMB':
      return '"¥" #,##0.00';
    default:
      return '#,##0.00';
  }
}

function exportValue(row: SydleExportRow, key: ExportColumnKey) {
  switch (key) {
    case 'process':
      return row.portalProcessCode || row.processCode || '';
    case 'phase':
      return phaseLabel(row.logisticStatus);
    case 'brand':
      return row.brand || row.portalBrand || '';
    case 'paymentType':
      return PAYMENT_TYPE_LABELS[row.paymentType] ?? row.paymentType ?? '';
    case 'paymentStatus':
      return PAYMENT_STATUS_LABELS[row.paymentStatus] ?? row.paymentStatus ?? '';
    case 'dueDate':
      return formatDateBr(row.dueDate);
    case 'invoiceIssuedDate':
      return formatDateBr(row.invoiceIssuedDate);
    case 'taskCreatedAt':
      return formatDateTimeBr(row.taskCreatedAt);
    case 'shipmentDate':
      return formatDateBr(row.shipmentDate);
    case 'purchaseAmount':
      return formatCurrencyBr(row.purchaseAmount, row.currency);
    case 'paidAmount':
      return formatCurrencyBr(row.paidAmount, row.currency);
    case 'openAmount':
      return formatCurrencyBr(row.openAmount, row.currency);
    case 'paidAt':
      return formatDateBr(row.paidAt);
    case 'scheduledAt':
      return formatDateBr(row.scheduledAt);
    case 'exchangeRate':
      return formatDecimalBr(row.exchangeRate, 6);
    case 'amountBrl':
      return formatCurrencyBr(row.amountBrl, 'BRL');
    case 'exchangeRateSource':
    case 'amountBrlSource':
      return row[key] === 'sydle' ? 'SYDLE' : '';
    case 'matchStatus':
      return MATCH_STATUS_LABELS[row.matchStatus as MatchStatus] ?? row.matchStatus ?? '';
    case 'matchReason':
      return matchReasonLabel(row.matchReason);
    case 'sourceUpdatedAt':
      return formatDateTimeBr(row.sourceUpdatedAt);
    case 'syncedAt':
      return formatDateTimeBr(row.syncedAt);
    default:
      return row[key] ?? '';
  }
}

function exportXlsxValue(row: SydleExportRow, key: ExportColumnKey): Date | number | string {
  switch (key) {
    case 'dueDate':
    case 'invoiceIssuedDate':
    case 'shipmentDate':
    case 'paidAt':
    case 'scheduledAt':
      return parseDateOnly(row[key]) ?? '';
    case 'taskCreatedAt':
    case 'sourceUpdatedAt':
    case 'syncedAt':
      return parseDateTime(row[key]) ?? '';
    case 'purchaseAmount':
    case 'paidAmount':
    case 'openAmount':
    case 'amountBrl':
    case 'exchangeRate':
      return toNumber(row[key]) ?? '';
    case 'paymentDeadlineAfterShipment':
      return row.paymentDeadlineAfterShipment ?? '';
    default:
      return sanitizeForSpreadsheet(exportValue(row, key));
  }
}

function xlsxNumberFormat(row: SydleExportRow, key: ExportColumnKey): string | null {
  switch (key) {
    case 'dueDate':
    case 'invoiceIssuedDate':
    case 'shipmentDate':
    case 'paidAt':
    case 'scheduledAt':
      return 'dd/mm/yyyy';
    case 'taskCreatedAt':
    case 'sourceUpdatedAt':
    case 'syncedAt':
      return 'dd/mm/yyyy hh:mm';
    case 'purchaseAmount':
    case 'paidAmount':
    case 'openAmount':
      return xlsxCurrencyFormat(row.currency);
    case 'amountBrl':
      return '"R$" #,##0.00';
    case 'exchangeRate':
      return '0.000000';
    case 'paymentDeadlineAfterShipment':
      return '0';
    default:
      return null;
  }
}

function pdfLine(y: number, fontSize: number, text: string): string {
  return `BT /F1 ${fontSize} Tf ${PDF_MARGIN_X} ${y} Td (${pdfEscape(text)}) Tj ET`;
}

function buildSimplePdf(lines: string[]): Buffer {
  const pages: string[] = [];
  let current: string[] = [];
  let y = PDF_MARGIN_TOP;

  for (const line of lines) {
    current.push(pdfLine(y, 8, line));
    y -= PDF_LINE_HEIGHT;
    if (y < 34) {
      pages.push(current.join('\n'));
      current = [];
      y = PDF_MARGIN_TOP;
    }
  }
  if (current.length) pages.push(current.join('\n'));

  const objects: string[] = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  const kids = pages.map((_page, index) => `${3 + index * 2} 0 R`).join(' ');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);

  pages.forEach((content, index) => {
    const pageObj = 3 + index * 2;
    const contentObj = pageObj + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${contentObj} 0 R >>`,
    );
    objects.push(
      `<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`,
    );
  });

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((obj, index) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

type SydleFinancialSourced<T> = T & {
  exchangeRateSource: 'sydle' | null;
  amountBrlSource: 'sydle' | null;
};

interface SydleFinancialFillable {
  exchangeRate: string | null;
  amountBrl: string | null;
}

/** Tag financial values only when they were provided by SYDLE itself. */
export function tagSydleFinancialSources<T extends SydleFinancialFillable>(
  row: T,
): SydleFinancialSourced<T> {
  return {
    ...row,
    exchangeRateSource: row.exchangeRate != null ? 'sydle' : null,
    amountBrlSource: row.amountBrl != null ? 'sydle' : null,
  };
}

export const sydleService = {
  getConfigStatus() {
    return getSydleConfigStatus();
  },

  async sync(trigger: SyncTrigger, userId: number | null = null, options: SyncOptions = {}) {
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

    return this.withSyncLock(async (acquired) => {
      if (!acquired) {
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
        const fullResync = Boolean(options.full);
        const cursorFrom = fullResync ? null : this.applyCursorOverlap(previousCursor);
        const client = new SydleClient();
        const fetched = await client.fetchPayments(cursorFrom);
        const normalized = fetched.records.map((record) => normalizeSydlePayment(record));
        const cursorTo = this.resolveCursorTo(
          fullResync ? null : previousCursor,
          normalized,
          fetched.cursorTo,
        );
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
            fullResync: fullResync || undefined,
            previousCursor: previousCursor?.toISOString() ?? null,
            cursorOverlapMs: SYDLE_CURSOR_OVERLAP_MS,
            cursorSource: cursorTo ? 'source_updated_at' : 'none',
          },
        });

        await auditService.log(userId, 'sydle_sync', 'sydle', run.id, completed, null);

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
        await auditService.log(userId, 'sydle_sync_failed', 'sydle', run.id, { message }, null);
        throw Object.assign(new Error(message), { syncRun: completed });
      }
    });
  },

  async withSyncLock<T>(callback: (acquired: boolean) => Promise<T>): Promise<T> {
    return db.transaction(async (tx: any) => {
      const result = await tx.execute(
        sql`SELECT pg_try_advisory_xact_lock(hashtext('sydle_purchase_payments_sync')) AS acquired`,
      );
      const rows = Array.isArray(result) ? result : ((result as any).rows ?? []);
      const acquired = Boolean(rows[0]?.acquired);
      return callback(acquired);
    });
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
          sydleProtocol: record.sydleProtocol,
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
          invoiceIssuedDate: record.invoiceIssuedDate,
          taskCreatedAt: record.taskCreatedAt,
          shipmentDate: record.shipmentDate,
          paymentDeadlineAfterShipment: record.paymentDeadlineAfterShipment,
          exceptionStatus: record.exceptionStatus,
          exceptionReason: record.exceptionReason,
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
          // onConflictDoUpdate makes the insert idempotent: if a concurrent
          // writer (or a duplicate externalId within this same batch) inserted
          // the row between the SELECT above and here, we update instead of
          // throwing a unique-violation that would be miscounted as an error.
          await db
            .insert(sydlePurchasePayments)
            .values(values)
            .onConflictDoUpdate({ target: sydlePurchasePayments.externalId, set: values });
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
        .where(or(inArray(importProcesses.purchaseRef, lookupValues), ...aiLookupConditions))
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
          sydleProtocol: sydlePurchasePayments.sydleProtocol,
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
          invoiceIssuedDate: sydlePurchasePayments.invoiceIssuedDate,
          taskCreatedAt: sydlePurchasePayments.taskCreatedAt,
          shipmentDate: sydlePurchasePayments.shipmentDate,
          paymentDeadlineAfterShipment: sydlePurchasePayments.paymentDeadlineAfterShipment,
          exceptionStatus: sydlePurchasePayments.exceptionStatus,
          exceptionReason: sydlePurchasePayments.exceptionReason,
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
          // Fase logística do processo casado — "em qual fase o processo está".
          logisticStatus: importProcesses.logisticStatus,
          processStatus: importProcesses.status,
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
        .leftJoin(importProcesses, eq(sydlePurchasePayments.processId, importProcesses.id))
        .where(where),
    ]);

    return {
      data: data.map((d) => tagSydleFinancialSources(d)),
      total: Number(countRow?.total ?? 0),
      page: filters.page,
      limit: filters.limit,
    };
  },

  // Full single-payment detail (all columns incl. the sanitized rawPayload) plus
  // the matched process context, for the "abrir compra" drawer.
  async getPaymentById(id: number) {
    const [row] = await db
      .select({
        ...getTableColumns(sydlePurchasePayments),
        portalProcessCode: importProcesses.processCode,
        portalBrand: importProcesses.brand,
        logisticStatus: importProcesses.logisticStatus,
        processStatus: importProcesses.status,
        processExporter: importProcesses.exporterName,
      })
      .from(sydlePurchasePayments)
      .leftJoin(importProcesses, eq(sydlePurchasePayments.processId, importProcesses.id))
      .where(eq(sydlePurchasePayments.id, id))
      .limit(1);
    if (!row) return null;
    return tagSydleFinancialSources(row);
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
      .leftJoin(importProcesses, eq(sydlePurchasePayments.processId, importProcesses.id))
      .where(where);

    // Per-currency breakdown so payments in EUR/CNY (or any non-USD currency)
    // are not silently dropped from the totals — the USD-only KPIs above would
    // otherwise hide them entirely from a financial report.
    const breakdownRows = await db
      .select({
        currency: sydlePurchasePayments.currency,
        totalPurchase: sql<string>`coalesce(sum(${sydlePurchasePayments.purchaseAmount}), 0)`,
        totalPaid: sql<string>`coalesce(sum(${sydlePurchasePayments.paidAmount}), 0)`,
        totalOpen: sql<string>`coalesce(sum(${sydlePurchasePayments.openAmount}), 0)`,
        records: sql<number>`count(*)::int`,
      })
      .from(sydlePurchasePayments)
      .leftJoin(importProcesses, eq(sydlePurchasePayments.processId, importProcesses.id))
      .where(where)
      .groupBy(sydlePurchasePayments.currency)
      .orderBy(desc(sql`sum(${sydlePurchasePayments.purchaseAmount})`));

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
      currencyBreakdown: breakdownRows.map((r) => ({
        currency: r.currency ?? 'USD',
        totalPurchase: Number(r.totalPurchase ?? 0),
        totalPaid: Number(r.totalPaid ?? 0),
        totalOpen: Number(r.totalOpen ?? 0),
        records: Number(r.records ?? 0),
      })),
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

  async exportRows(filters: SydleReportQuery) {
    const firstPage = await this.list({ ...filters, page: 1, limit: CSV_EXPORT_PAGE_SIZE });
    const rows = [...firstPage.data];
    let page = 2;

    while (rows.length < firstPage.total) {
      const nextPage = await this.list({ ...filters, page, limit: CSV_EXPORT_PAGE_SIZE });
      if (nextPage.data.length === 0) break;
      rows.push(...nextPage.data);
      page += 1;
    }

    return rows;
  },

  async exportCsv(filters: SydleReportQuery): Promise<string> {
    const rows = await this.exportRows(filters);
    const header = EXPORT_COLUMNS.map((column) => column.header);

    return [
      csvLine(header),
      ...rows.map((row) => csvLine(EXPORT_COLUMNS.map((column) => exportValue(row, column.key)))),
    ].join('\n');
  },

  async exportXlsx(filters: SydleReportQuery): Promise<Buffer> {
    const rows = await this.exportRows(filters);
    const aoa = [
      EXPORT_COLUMNS.map((column) => column.header),
      ...rows.map((row) => EXPORT_COLUMNS.map((column) => exportXlsxValue(row, column.key))),
    ];
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
    rows.forEach((row, rowIndex) => {
      EXPORT_COLUMNS.forEach((column, columnIndex) => {
        const address = XLSX.utils.encode_cell({ r: rowIndex + 1, c: columnIndex });
        const cell = worksheet[address];
        if (!cell) return;
        const format = xlsxNumberFormat(row, column.key);
        if (format) cell.z = format;
      });
    });
    worksheet['!cols'] = EXPORT_COLUMNS.map((column) => ({
      wch: Math.min(Math.max(column.header.length + 4, 12), 32),
    }));
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Compras SYDLE');
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  },

  async exportPdf(filters: SydleReportQuery): Promise<Buffer> {
    const rows = await this.exportRows(filters);
    const generatedAt = formatDateTimeBr(new Date());
    const lines = [
      'Relatorio SYDLE - Compras e Pagamentos Internacionais',
      `Gerado em ${generatedAt} | Registros: ${rows.length}`,
      '',
      'Processo | Fase | Fornecedor | Moeda | Valor | Pago | Saldo | Status | Vencimento | Banco | Contrato | Conciliacao',
      '-'.repeat(150),
      ...rows.map((row) =>
        [
          truncate(exportValue(row, 'process'), 14),
          truncate(exportValue(row, 'phase'), 16),
          truncate(row.supplierName || '', 28),
          row.currency,
          truncate(exportValue(row, 'purchaseAmount'), 14),
          truncate(exportValue(row, 'paidAmount'), 14),
          truncate(exportValue(row, 'openAmount'), 14),
          truncate(exportValue(row, 'paymentStatus'), 12),
          exportValue(row, 'dueDate'),
          truncate(row.bankName || '', 16),
          truncate(row.contractNumber || '', 14),
          truncate(exportValue(row, 'matchStatus'), 14),
        ].join(' | '),
      ),
    ];
    return buildSimplePdf(lines);
  },
};
