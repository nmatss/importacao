import { createHash } from 'node:crypto';

export type SydlePaymentType = 'deposit' | 'balance' | 'fee' | 'refund' | 'other';
export type SydlePaymentStatus =
  | 'open'
  | 'scheduled'
  | 'paid'
  | 'overdue'
  | 'cancelled'
  | 'unknown';

export interface NormalizedSydlePayment {
  externalId: string;
  processCode: string | null;
  purchaseRef: string | null;
  purchaseOrder: string | null;
  proformaNumber: string | null;
  invoiceNumber: string | null;
  supplierName: string | null;
  brand: string | null;
  currency: string;
  purchaseAmount: number | null;
  paidAmount: number | null;
  openAmount: number | null;
  paymentType: SydlePaymentType;
  paymentStatus: SydlePaymentStatus;
  dueDate: string | null;
  paidAt: Date | null;
  scheduledAt: Date | null;
  exchangeRate: number | null;
  amountBrl: number | null;
  bankName: string | null;
  contractNumber: string | null;
  remittanceId: string | null;
  sourceUpdatedAt: Date | null;
  rawPayload: Record<string, unknown>;
}

type RawRecord = Record<string, unknown>;

const FIELD_KEYS = {
  externalId: [
    'externalId',
    'id',
    '_id',
    'codigo',
    'codigoPagamento',
    'paymentId',
    'pagamentoId',
    'identificador',
  ],
  processCode: [
    'processCode',
    'process_code',
    'processo',
    'codigoProcesso',
    'codProcesso',
    'process',
  ],
  purchaseRef: [
    'purchaseRef',
    'purchase_ref',
    'compra',
    'referenciaCompra',
    'refCompra',
    'purchase',
  ],
  purchaseOrder: [
    'purchaseOrder',
    'purchase_order',
    'po',
    'poNumber',
    'numeroPedido',
    'pedidoCompra',
    'ordemCompra',
  ],
  proformaNumber: ['proformaNumber', 'proforma', 'piNumber', 'pi', 'numeroPi', 'proformaInvoice'],
  invoiceNumber: ['invoiceNumber', 'invoice', 'commercialInvoice', 'ciNumber', 'numeroInvoice'],
  supplierName: ['supplierName', 'supplier', 'fornecedor', 'exportador', 'shipper', 'vendor'],
  brand: ['brand', 'marca', 'businessUnit', 'unidade'],
  currency: ['currency', 'moeda'],
  purchaseAmount: [
    'purchaseAmount',
    'valorCompra',
    'valorComprado',
    'amount',
    'amountUsd',
    'valorUsd',
    'totalUsd',
    'valorInvoice',
  ],
  paidAmount: ['paidAmount', 'valorPago', 'amountPaid', 'pagoUsd', 'valorPagoUsd'],
  openAmount: ['openAmount', 'saldoAberto', 'saldo', 'valorAberto', 'remainingAmount'],
  paymentType: ['paymentType', 'tipoPagamento', 'tipo', 'parcela', 'installmentType'],
  paymentStatus: ['paymentStatus', 'statusPagamento', 'status', 'situacao'],
  dueDate: ['dueDate', 'vencimento', 'dataVencimento', 'paymentDeadline', 'prazoPagamento'],
  paidAt: ['paidAt', 'dataPagamento', 'paymentDate', 'pagoEm'],
  scheduledAt: ['scheduledAt', 'dataAgendada', 'scheduledDate', 'agendadoEm'],
  exchangeRate: ['exchangeRate', 'taxaCambio', 'taxa', 'ptax'],
  amountBrl: ['amountBrl', 'valorBrl', 'valorReal', 'valorReais'],
  bankName: ['bankName', 'banco', 'bank'],
  contractNumber: ['contractNumber', 'contratoCambio', 'contrato', 'exchangeContract'],
  remittanceId: ['remittanceId', 'remessa', 'swift', 'remittance'],
  sourceUpdatedAt: [
    'sourceUpdatedAt',
    'updatedAt',
    'ultimaAtualizacao',
    'modifiedAt',
    'alteradoEm',
  ],
} as const;

function normalizeKey(key: string): string {
  return key
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
    .join(',')}}`;
}

function findValue(record: RawRecord, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) return record[key];
  }

  const normalized = new Map<string, unknown>();
  for (const [key, value] of Object.entries(record)) {
    normalized.set(normalizeKey(key), value);
  }

  for (const key of keys) {
    const value = normalized.get(normalizeKey(key));
    if (value !== undefined) return value;
  }

  return undefined;
}

function stringOrNull(value: unknown, maxLength = 255): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

export function parseSydleNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const raw = String(value)
    .trim()
    .replace(/[^\d,.-]/g, '');
  if (!raw || raw === '-' || raw === ',' || raw === '.') return null;

  const commaIndex = raw.lastIndexOf(',');
  const dotIndex = raw.lastIndexOf('.');
  let normalized = raw;

  if (commaIndex >= 0 && dotIndex >= 0) {
    normalized =
      commaIndex > dotIndex ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
  } else if (commaIndex >= 0) {
    normalized = raw.replace(/\./g, '').replace(',', '.');
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(raw)) {
    normalized = raw.replace(/\./g, '');
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseDateOnly(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'number' && Number.isFinite(value) && value > 1000) {
    const date = new Date((value - 25569) * 86400 * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }

  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

export function parseSydleDateTime(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  if (typeof value === 'number' && Number.isFinite(value) && value > 1000) {
    const date = new Date((value - 25569) * 86400 * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const raw = String(value).trim();
  const brDateTime = raw.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (brDateTime) {
    const [, day, month, year, hour = '0', minute = '0', second = '0'] = brDateTime;
    const date = new Date(
      Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
      ),
    );
    if (
      !Number.isNaN(date.getTime()) &&
      date.getUTCFullYear() === Number(year) &&
      date.getUTCMonth() === Number(month) - 1 &&
      date.getUTCDate() === Number(day)
    ) {
      return date;
    }
    return null;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  const dateOnly = parseDateOnly(value);
  return dateOnly ? new Date(`${dateOnly}T00:00:00Z`) : null;
}

function parseDateTime(value: unknown): Date | null {
  return parseSydleDateTime(value);
}

function normalizeCurrency(value: unknown): string {
  const currency = stringOrNull(value, 3)?.toUpperCase() ?? 'USD';
  if (currency === 'US$' || currency === '$') return 'USD';
  if (currency === 'R$') return 'BRL';
  return /^[A-Z]{3}$/.test(currency) ? currency : 'USD';
}

function normalizePaymentType(value: unknown): SydlePaymentType {
  const raw = normalizeKey(String(value ?? ''));
  if (!raw) return 'other';
  if (/(deposit|sinal|entrada|adiantamento)/.test(raw)) return 'deposit';
  if (/(balance|saldo|final|restante)/.test(raw)) return 'balance';
  if (/(fee|taxa|tarifa|despesa|custo)/.test(raw)) return 'fee';
  if (/(refund|reembolso|estorno|devolucao)/.test(raw)) return 'refund';
  return 'other';
}

function normalizePaymentStatus(
  value: unknown,
  dueDate: string | null,
  paidAmount: number | null,
  purchaseAmount: number | null,
): SydlePaymentStatus {
  const raw = normalizeKey(String(value ?? ''));
  if (/(cancel|cancelado|cancelada|anulado)/.test(raw)) return 'cancelled';
  if (/(paid|pago|liquidado|baixado|concluido)/.test(raw)) return 'paid';
  if (/(scheduled|agendado|programado)/.test(raw)) return 'scheduled';
  if (/(overdue|vencido|atrasado)/.test(raw)) return 'overdue';
  if (/(open|aberto|pendente|aguardando|emaberto)/.test(raw)) return 'open';

  if (purchaseAmount !== null && paidAmount !== null && paidAmount >= purchaseAmount) return 'paid';
  if (dueDate && new Date(`${dueDate}T23:59:59Z`).getTime() < Date.now()) return 'overdue';
  return raw ? 'unknown' : 'open';
}

export function extractSydleRecords(payload: unknown): RawRecord[] {
  if (Array.isArray(payload)) return payload.filter(isRawRecord);
  if (!isRawRecord(payload)) return [];

  const candidateKeys = ['data', 'items', 'results', 'records', 'content', 'payments'];
  for (const key of candidateKeys) {
    const value = payload[key];
    if (Array.isArray(value)) return value.filter(isRawRecord);
  }

  return [];
}

function isRawRecord(value: unknown): value is RawRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

const SENSITIVE_RAW_PAYLOAD_KEY = new RegExp(
  [
    'authorization',
    'bearer',
    'token',
    'secret',
    'password',
    'senha',
    'apikey',
    'api_key',
    'cookie',
    'account(number)?',
    'conta',
    'agency',
    'agencia',
    'iban',
    'routing',
    'pix',
    'chavepix',
  ].join('|'),
  'i',
);

export function sanitizeSydleRawPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeSydleRawPayload(item));
  }

  if (!isRawRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      SENSITIVE_RAW_PAYLOAD_KEY.test(normalizeKey(key))
        ? '[REDACTED]'
        : sanitizeSydleRawPayload(nestedValue),
    ]),
  );
}

export function normalizeSydlePayment(record: RawRecord): NormalizedSydlePayment {
  const externalId =
    stringOrNull(findValue(record, FIELD_KEYS.externalId), 255) ??
    `hash:${createHash('sha256').update(stableStringify(record)).digest('hex').slice(0, 48)}`;

  const purchaseAmount = parseSydleNumber(findValue(record, FIELD_KEYS.purchaseAmount));
  const paidAmount = parseSydleNumber(findValue(record, FIELD_KEYS.paidAmount));
  const openAmountFromSource = parseSydleNumber(findValue(record, FIELD_KEYS.openAmount));
  const openAmount =
    openAmountFromSource ??
    (purchaseAmount !== null && paidAmount !== null ? round2(purchaseAmount - paidAmount) : null);
  const dueDate = parseDateOnly(findValue(record, FIELD_KEYS.dueDate));

  return {
    externalId,
    processCode: stringOrNull(findValue(record, FIELD_KEYS.processCode), 50),
    purchaseRef: stringOrNull(findValue(record, FIELD_KEYS.purchaseRef), 100),
    purchaseOrder: stringOrNull(findValue(record, FIELD_KEYS.purchaseOrder), 100),
    proformaNumber: stringOrNull(findValue(record, FIELD_KEYS.proformaNumber), 100),
    invoiceNumber: stringOrNull(findValue(record, FIELD_KEYS.invoiceNumber), 100),
    supplierName: stringOrNull(findValue(record, FIELD_KEYS.supplierName), 255),
    brand: stringOrNull(findValue(record, FIELD_KEYS.brand), 50)?.toLowerCase() ?? null,
    currency: normalizeCurrency(findValue(record, FIELD_KEYS.currency)),
    purchaseAmount,
    paidAmount,
    openAmount,
    paymentType: normalizePaymentType(findValue(record, FIELD_KEYS.paymentType)),
    paymentStatus: normalizePaymentStatus(
      findValue(record, FIELD_KEYS.paymentStatus),
      dueDate,
      paidAmount,
      purchaseAmount,
    ),
    dueDate,
    paidAt: parseDateTime(findValue(record, FIELD_KEYS.paidAt)),
    scheduledAt: parseDateTime(findValue(record, FIELD_KEYS.scheduledAt)),
    exchangeRate: parseSydleNumber(findValue(record, FIELD_KEYS.exchangeRate)),
    amountBrl: parseSydleNumber(findValue(record, FIELD_KEYS.amountBrl)),
    bankName: stringOrNull(findValue(record, FIELD_KEYS.bankName), 255),
    contractNumber: stringOrNull(findValue(record, FIELD_KEYS.contractNumber), 100),
    remittanceId: stringOrNull(findValue(record, FIELD_KEYS.remittanceId), 100),
    sourceUpdatedAt: parseDateTime(findValue(record, FIELD_KEYS.sourceUpdatedAt)),
    rawPayload: sanitizeSydleRawPayload(record) as Record<string, unknown>,
  };
}
