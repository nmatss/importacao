import { compareDates, parseDate } from '../utils/date-compare.js';

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

function normalize(value: unknown): string {
  return String(value ?? '').trim();
}

type DateEntry = {
  label: string;
  value: string;
};

const INVOICE_SHIPMENT_DATE_KEYS = [
  'shipmentDate',
  'shippingDate',
  'dateOfShipment',
  'shippedOnBoardDate',
  'onBoardDate',
  'etd',
];

const PACKING_LIST_SHIPMENT_DATE_KEYS = [
  'shipmentDate',
  'shippingDate',
  'dateOfShipment',
  'shippedOnBoardDate',
  'onBoardDate',
  'etd',
];

const BL_SHIPMENT_DATE_KEYS = [
  'shipmentDate',
  'shippedOnBoardDate',
  'dateOfShipment',
  'onBoardDate',
  'etd',
];

// Eduarda 2026-06-19: "Considerar a data da Invoice e do Packing List para a aba
// de Comparativo, mas considerar errado apenas se forem muito divergentes". When
// a document carries no logistics/shipment date we therefore fall back to its
// own emission date (invoice issue date / PL date) so the comparison still
// happens — and widen the tolerance, since an emission date is expected to drift
// further from the on-board date than two shipment dates would.
const INVOICE_EMISSION_DATE_KEYS = ['invoiceDate', 'issueDate', 'date'];
const PACKING_LIST_EMISSION_DATE_KEYS = ['date', 'packingListDate', 'issueDate'];
const BL_EMISSION_DATE_KEYS = ['issueDate'];

type ResolvedDate = { value: string; fallback: boolean };

function resolveDate(
  source: Record<string, any> | undefined,
  shipmentKeys: string[],
  emissionKeys: string[],
): ResolvedDate {
  if (!source) return { value: '', fallback: false };
  for (const key of shipmentKeys) {
    const raw = normalize(source[key]);
    if (raw) return { value: normalizeDate(raw), fallback: false };
  }
  for (const key of emissionKeys) {
    const raw = normalize(source[key]);
    if (raw) return { value: normalizeDate(raw), fallback: true };
  }
  return { value: '', fallback: false };
}

function normalizeDate(value: string): string {
  const parsed = parseDate(value);
  if (!parsed) return value;
  return parsed.toISOString().slice(0, 10);
}

export default function datesMatch(input: CheckInput): CheckResult {
  const checkName = 'dates-match';

  if (!input.invoiceData) {
    return {
      checkName,
      status: 'skipped',
      documentsCompared: 'INV vs BL',
      message: 'aguardando INV',
    };
  }

  const inv = resolveDate(
    input.invoiceData,
    INVOICE_SHIPMENT_DATE_KEYS,
    INVOICE_EMISSION_DATE_KEYS,
  );
  const pl = resolveDate(
    input.packingListData,
    PACKING_LIST_SHIPMENT_DATE_KEYS,
    PACKING_LIST_EMISSION_DATE_KEYS,
  );
  const bl = resolveDate(input.blData, BL_SHIPMENT_DATE_KEYS, BL_EMISSION_DATE_KEYS);
  const present: Array<DateEntry & { fallback: boolean }> = [
    { label: 'INV', ...inv },
    { label: 'PL', ...pl },
    { label: 'BL', ...bl },
  ].filter((entry) => entry.value);

  if (present.length === 0) {
    return {
      checkName,
      status: 'skipped',
      documentsCompared: 'INV vs PL vs BL',
      message: 'Nenhuma data de embarque/ETD ou de emissao encontrada nos documentos.',
    };
  }

  if (present.length === 1) {
    return {
      checkName,
      status: 'skipped',
      expectedValue: present[0].value,
      actualValue: present[0].value,
      documentsCompared: 'INV vs PL vs BL',
      message: `Data encontrada apenas em ${present[0].label}, impossivel comparar.`,
    };
  }

  // When any date is an emission-date fallback, only flag VERY divergent dates —
  // emission and on-board dates legitimately differ by more than two shipment
  // dates would (Eduarda: "nao precisam necessariamente ser iguais").
  const usedFallback = present.some((entry) => entry.fallback);
  const status = compareDates(
    present.map((entry) => entry.value),
    usedFallback ? { matchDays: 30, warnDays: 60 } : { matchDays: 10, warnDays: 30 },
  );
  const actualValue = present.map((entry) => `${entry.label}=${entry.value}`).join('; ');
  const expectedValue = present[0].value;
  const ignoredInvoiceDateNote = usedFallback
    ? ' Considerada a data de emissao da Invoice/PL na ausencia de data de embarque.'
    : '';

  if (status === 'match') {
    return {
      checkName,
      status: 'passed',
      expectedValue,
      actualValue,
      documentsCompared: 'INV vs PL vs BL',
      message: `Datas de ETD / embarque estao dentro da tolerancia operacional.${ignoredInvoiceDateNote}`,
    };
  }

  if (status === 'warning') {
    return {
      checkName,
      status: 'warning',
      expectedValue,
      actualValue,
      documentsCompared: 'INV vs PL vs BL',
      message: `Datas de ETD / embarque divergem pouco; revisar se necessario.${ignoredInvoiceDateNote}`,
    };
  }

  return {
    checkName,
    status: 'failed',
    expectedValue,
    actualValue,
    documentsCompared: 'INV vs PL vs BL',
    message: `Divergencia relevante de datas: ${actualValue}.`,
  };
}
