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

const TOLERANCE = 0.5;

export default function netWeightMatch(input: CheckInput): CheckResult {
  const checkName = 'net-weight-match';

  const invNetWeight = input.invoiceData?.totalNetWeight != null ? Number(input.invoiceData.totalNetWeight) : null;
  const plNetWeight = input.packingListData?.totalNetWeight != null ? Number(input.packingListData.totalNetWeight) : null;

  if (invNetWeight == null && plNetWeight == null) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: 'INV vs PL',
      message: 'Net weight not found in either document.',
    };
  }

  if (invNetWeight == null || plNetWeight == null) {
    return {
      checkName,
      status: 'warning',
      expectedValue: invNetWeight?.toFixed(3) ?? undefined,
      actualValue: plNetWeight?.toFixed(3) ?? undefined,
      documentsCompared: 'INV vs PL',
      message: 'Net weight found in only one document, unable to compare.',
    };
  }

  const difference = Math.abs(invNetWeight - plNetWeight);

  if (difference <= TOLERANCE) {
    return {
      checkName,
      status: 'passed',
      expectedValue: invNetWeight.toFixed(3),
      actualValue: plNetWeight.toFixed(3),
      documentsCompared: 'INV vs PL',
      message: `Net weight matches within tolerance (diff: ${difference.toFixed(3)} kg).`,
    };
  }

  return {
    checkName,
    status: 'failed',
    expectedValue: invNetWeight.toFixed(3),
    actualValue: plNetWeight.toFixed(3),
    documentsCompared: 'INV vs PL',
    message: `Net weight mismatch: INV=${invNetWeight.toFixed(3)} kg vs PL=${plNetWeight.toFixed(3)} kg (diff: ${difference.toFixed(3)} kg, tolerance: ${TOLERANCE} kg).`,
  };
}
