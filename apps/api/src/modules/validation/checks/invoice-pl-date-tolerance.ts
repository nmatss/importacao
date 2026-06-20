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

// Wider tolerance used when one side only has an emission date (no shipment/ETD).
// Emission and shipment dates legitimately drift further apart (Eduarda
// 2026-06-19: "nao precisam necessariamente ser iguais").
export const INVOICE_PL_EMISSION_TOLERANCE_DAYS = 60;

// Shipment / ETD date keys, preferred order.
const SHIPMENT_DATE_KEYS = [
  'shipmentDate',
  'shippingDate',
  'dateOfShipment',
  'shippedOnBoardDate',
  'onBoardDate',
  'etd',
];

// Emission-date fallback so the Invoice/PL dates still participate in the
// Comparativo when no shipment/ETD date was extracted.
const INVOICE_EMISSION_DATE_KEYS = ['invoiceDate', 'issueDate', 'date'];
const PACKING_LIST_EMISSION_DATE_KEYS = ['date', 'packingListDate', 'issueDate'];

type ResolvedDate = { value: string; fallback: boolean };

function resolveDate(
  source: Record<string, any> | undefined,
  emissionKeys: string[],
): ResolvedDate {
  if (!source) return { value: '', fallback: false };
  for (const key of SHIPMENT_DATE_KEYS) {
    const raw = String(source[key] ?? '').trim();
    if (raw) {
      const parsed = parseDate(raw);
      return { value: parsed ? parsed.toISOString().slice(0, 10) : '', fallback: false };
    }
  }
  for (const key of emissionKeys) {
    const raw = String(source[key] ?? '').trim();
    if (raw) {
      const parsed = parseDate(raw);
      return { value: parsed ? parsed.toISOString().slice(0, 10) : '', fallback: true };
    }
  }
  return { value: '', fallback: false };
}

export default function invoicePlDateTolerance(input: CheckInput): CheckResult {
  const checkName = 'invoice-pl-date-tolerance';

  const inv = resolveDate(input.invoiceData, INVOICE_EMISSION_DATE_KEYS);
  const pl = resolveDate(input.packingListData, PACKING_LIST_EMISSION_DATE_KEYS);

  // No-op cleanly when either comparison source is missing — never a false fail.
  if (!inv.value || !pl.value) {
    return {
      checkName,
      status: 'skipped',
      documentsCompared: 'INV vs PL',
      message:
        'Sem data de embarque/ETD nem de emissao em um dos documentos (INV ou PL); comparacao de datas ignorada.',
    };
  }

  const invDate = parseDate(inv.value);
  const plDate = parseDate(pl.value);
  if (!invDate || !plDate) {
    return {
      checkName,
      status: 'skipped',
      documentsCompared: 'INV vs PL',
      message: 'Datas em formato nao reconhecido; comparacao ignorada.',
    };
  }

  const usedFallback = inv.fallback || pl.fallback;
  const tolerance = usedFallback
    ? INVOICE_PL_EMISSION_TOLERANCE_DAYS
    : INVOICE_PL_DATE_TOLERANCE_DAYS;
  const dateKind = usedFallback ? 'embarque/emissao' : 'embarque/ETD';
  const diffDays = Math.round(daysBetween(invDate, plDate));
  const actualValue = `INV=${inv.value}; PL=${pl.value} (${diffDays}d)`;

  if (diffDays <= tolerance) {
    return {
      checkName,
      status: 'passed',
      expectedValue: `diferenca <= ${tolerance} dias`,
      actualValue,
      documentsCompared: 'INV vs PL',
      message: `Datas de ${dateKind} da Invoice e Packing List dentro da tolerancia (${diffDays} dia(s), limite ${tolerance}).`,
    };
  }

  return {
    checkName,
    status: 'warning',
    expectedValue: `diferenca <= ${tolerance} dias`,
    actualValue,
    documentsCompared: 'INV vs PL',
    message: `Datas de ${dateKind} da Invoice e Packing List divergem muito: ${diffDays} dias (limite ${tolerance}). Revisar.`,
  };
}
