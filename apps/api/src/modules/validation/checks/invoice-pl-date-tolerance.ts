import { daysBetween, parseDate } from '../utils/date-compare.js';

interface CheckInput {
  invoiceData?: Record<string, any>;
  packingListData?: Record<string, any>;
  blData?: Record<string, any>;
  processData?: Record<string, any>;
  followUpData?: Record<string, any>;
}

interface CheckResult {
  checkName: string;
  status: 'passed' | 'failed' | 'warning' | 'skipped';
  expectedValue?: string;
  actualValue?: string;
  documentsCompared: string;
  message: string;
}

/**
 * Cross-document ETD / shipment date comparison between the Invoice and the
 * Packing List for the Comparativo tab.
 *
 * Invoice and Packing List shipment dates need NOT be identical — they are
 * produced at slightly different moments and legitimately drift by a few days.
 * We therefore only flag when the two dates are VERY divergent. Equal-ish dates
 * (within tolerance) must PASS.
 *
 * Consistent with commit ca1c401 ("skip date check without comparison source"),
 * the check no-ops cleanly (status 'skipped') when either date is missing — it
 * must never emit a false failure on empty input.
 */

// Documented tolerance: divergences up to this many days are operationally
// acceptable between Invoice and Packing List shipment dates and PASS.
export const INVOICE_PL_DATE_TOLERANCE_DAYS = 30;

// Shipment / ETD date keys, preferred order. Invoice issue date is deliberately
// excluded — it is not a logistics/shipment date.
const SHIPMENT_DATE_KEYS = [
  'shipmentDate',
  'shippingDate',
  'dateOfShipment',
  'shippedOnBoardDate',
  'onBoardDate',
  'etd',
];

function firstShipmentDate(source: Record<string, any> | undefined): string {
  if (!source) return '';
  for (const key of SHIPMENT_DATE_KEYS) {
    const raw = String(source[key] ?? '').trim();
    if (raw) {
      const parsed = parseDate(raw);
      return parsed ? parsed.toISOString().slice(0, 10) : '';
    }
  }
  return '';
}

export default function invoicePlDateTolerance(input: CheckInput): CheckResult {
  const checkName = 'invoice-pl-date-tolerance';

  const invDateStr = firstShipmentDate(input.invoiceData);
  const plDateStr = firstShipmentDate(input.packingListData);

  // No-op cleanly when either comparison source is missing — never a false fail.
  if (!invDateStr || !plDateStr) {
    return {
      checkName,
      status: 'skipped',
      documentsCompared: 'INV vs PL',
      message:
        'Sem data de embarque/ETD em um dos documentos (INV ou PL); comparacao de datas ignorada.',
    };
  }

  const invDate = parseDate(invDateStr);
  const plDate = parseDate(plDateStr);
  if (!invDate || !plDate) {
    return {
      checkName,
      status: 'skipped',
      documentsCompared: 'INV vs PL',
      message: 'Datas de embarque/ETD em formato nao reconhecido; comparacao ignorada.',
    };
  }

  const diffDays = Math.round(daysBetween(invDate, plDate));
  const actualValue = `INV=${invDateStr}; PL=${plDateStr} (${diffDays}d)`;

  if (diffDays <= INVOICE_PL_DATE_TOLERANCE_DAYS) {
    return {
      checkName,
      status: 'passed',
      expectedValue: `diferenca <= ${INVOICE_PL_DATE_TOLERANCE_DAYS} dias`,
      actualValue,
      documentsCompared: 'INV vs PL',
      message: `Datas de embarque/ETD da Invoice e Packing List dentro da tolerancia (${diffDays} dia(s), limite ${INVOICE_PL_DATE_TOLERANCE_DAYS}).`,
    };
  }

  return {
    checkName,
    status: 'warning',
    expectedValue: `diferenca <= ${INVOICE_PL_DATE_TOLERANCE_DAYS} dias`,
    actualValue,
    documentsCompared: 'INV vs PL',
    message: `Datas de embarque/ETD da Invoice e Packing List divergem muito: ${diffDays} dias (limite ${INVOICE_PL_DATE_TOLERANCE_DAYS}). Revisar.`,
  };
}
