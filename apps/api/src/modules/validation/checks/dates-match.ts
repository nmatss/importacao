interface CheckInput {
  invoiceData?: Record<string, any>;
  packingListData?: Record<string, any>;
  blData?: Record<string, any>;
  processData?: Record<string, any>;
  followUpData?: Record<string, any>;
}

interface CheckResult {
  checkName: string;
  status: 'passed' | 'failed' | 'warning';
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
    const d = new Date(`${brMatch[3]}-${brMatch[2].padStart(2, '0')}-${brMatch[1].padStart(2, '0')}`);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return value;
}

export default function datesMatch(input: CheckInput): CheckResult {
  const checkName = 'dates-match';

  const invEtdRaw = normalize(input.invoiceData?.etd ?? input.invoiceData?.shipmentDate);
  const blShippedRaw = normalize(input.blData?.shippedOnBoardDate ?? input.blData?.etd);
  const invEtd = normalizeDate(invEtdRaw);
  const blShippedOnBoard = normalizeDate(blShippedRaw);

  if (!invEtd && !blShippedOnBoard) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: 'INV vs BL',
      message: 'No ETD or shipped on board date found in either document.',
    };
  }

  if (!invEtd || !blShippedOnBoard) {
    return {
      checkName,
      status: 'warning',
      expectedValue: invEtd || undefined,
      actualValue: blShippedOnBoard || undefined,
      documentsCompared: 'INV vs BL',
      message: 'Date found in only one document, unable to compare.',
    };
  }

  if (invEtd === blShippedOnBoard) {
    return {
      checkName,
      status: 'passed',
      expectedValue: invEtd,
      actualValue: blShippedOnBoard,
      documentsCompared: 'INV vs BL',
      message: 'ETD / shipped on board date matches between invoice and BL.',
    };
  }

  return {
    checkName,
    status: 'failed',
    expectedValue: invEtd,
    actualValue: blShippedOnBoard,
    documentsCompared: 'INV vs BL',
    message: `Date mismatch: INV="${invEtd}" vs BL="${blShippedOnBoard}".`,
  };
}
