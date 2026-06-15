import { compareDates } from '../utils/date-compare.js';

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

function normalizeDate(value: string): string {
  if (!value) return '';
  // Try parsing as Date to normalize different formats
  const parsed = new Date(value);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10); // YYYY-MM-DD
  }
  // Try DD/MM/YYYY format common in Brazilian documents
  const brMatch = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (brMatch) {
    const d = new Date(
      `${brMatch[3]}-${brMatch[2].padStart(2, '0')}-${brMatch[1].padStart(2, '0')}`,
    );
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return value;
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

  const invEtdRaw = normalize(
    input.invoiceData?.invoiceDate ?? input.invoiceData?.etd ?? input.invoiceData?.shipmentDate,
  );
  const plDateRaw = normalize(
    input.packingListData?.shipmentDate ??
      input.packingListData?.etd ??
      input.packingListData?.invoiceDate ??
      input.packingListData?.date,
  );
  const blShippedRaw = normalize(
    input.blData?.shipmentDate ?? input.blData?.shippedOnBoardDate ?? input.blData?.etd,
  );
  const invEtd = normalizeDate(invEtdRaw);
  const plDate = normalizeDate(plDateRaw);
  const blShippedOnBoard = normalizeDate(blShippedRaw);
  const present = [
    { label: 'INV', value: invEtd },
    { label: 'PL', value: plDate },
    { label: 'BL', value: blShippedOnBoard },
  ].filter((entry) => entry.value);

  if (present.length === 0) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: 'INV vs PL vs BL',
      message: 'Nenhuma data de ETD ou embarque encontrada nos documentos.',
    };
  }

  if (present.length === 1) {
    return {
      checkName,
      status: 'warning',
      expectedValue: invEtd || undefined,
      actualValue: plDate || blShippedOnBoard || undefined,
      documentsCompared: 'INV vs PL vs BL',
      message: `Data encontrada apenas em ${present[0].label}, impossivel comparar.`,
    };
  }

  const status = compareDates(
    present.map((entry) => entry.value),
    { matchDays: 10, warnDays: 30 },
  );
  const actualValue = present.map((entry) => `${entry.label}=${entry.value}`).join('; ');

  if (status === 'match') {
    return {
      checkName,
      status: 'passed',
      expectedValue: invEtd,
      actualValue,
      documentsCompared: 'INV vs PL vs BL',
      message: 'Datas de ETD / embarque estao dentro da tolerancia operacional.',
    };
  }

  if (status === 'warning') {
    return {
      checkName,
      status: 'warning',
      expectedValue: invEtd,
      actualValue,
      documentsCompared: 'INV vs PL vs BL',
      message: 'Datas de ETD / embarque divergem pouco; revisar se necessario.',
    };
  }

  return {
    checkName,
    status: 'failed',
    expectedValue: invEtd,
    actualValue,
    documentsCompared: 'INV vs PL vs BL',
    message: `Divergencia relevante de datas: ${actualValue}.`,
  };
}
