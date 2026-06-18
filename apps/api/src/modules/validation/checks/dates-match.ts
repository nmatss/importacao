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

function firstDate(source: Record<string, any> | undefined, keys: string[]): string {
  if (!source) return '';
  for (const key of keys) {
    const raw = normalize(source[key]);
    if (raw) return normalizeDate(raw);
  }
  return '';
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

  const invShipment = firstDate(input.invoiceData, INVOICE_SHIPMENT_DATE_KEYS);
  const plShipment = firstDate(input.packingListData, PACKING_LIST_SHIPMENT_DATE_KEYS);
  const blShipment = firstDate(input.blData, BL_SHIPMENT_DATE_KEYS);
  const invoiceDateIgnored = !invShipment && normalize(input.invoiceData?.invoiceDate);
  const present: DateEntry[] = [
    { label: 'INV', value: invShipment },
    { label: 'PL', value: plShipment },
    { label: 'BL', value: blShipment },
  ].filter((entry) => entry.value);

  if (present.length === 0 && invoiceDateIgnored) {
    return {
      checkName,
      status: 'skipped',
      documentsCompared: 'INV vs PL vs BL',
      message:
        'A invoice possui apenas data de emissao; nenhuma data de ETD ou embarque foi encontrada para comparar.',
    };
  }

  if (present.length === 0) {
    return {
      checkName,
      status: 'skipped',
      documentsCompared: 'INV vs PL vs BL',
      message: 'Nenhuma data de ETD ou embarque encontrada nos documentos.',
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

  const status = compareDates(
    present.map((entry) => entry.value),
    { matchDays: 10, warnDays: 30 },
  );
  const actualValue = present.map((entry) => `${entry.label}=${entry.value}`).join('; ');
  const expectedValue = present[0].value;
  const ignoredInvoiceDateNote = invoiceDateIgnored
    ? ' Data de emissao da invoice nao foi usada como data logistica.'
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
