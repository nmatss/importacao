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

export default function datesMatch(input: CheckInput): CheckResult {
  const checkName = 'dates-match';

  const invEtd = normalize(input.invoiceData?.etd ?? input.invoiceData?.shipmentDate);
  const blShippedOnBoard = normalize(input.blData?.shippedOnBoardDate ?? input.blData?.etd);

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
