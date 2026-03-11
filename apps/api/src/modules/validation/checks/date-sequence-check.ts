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

function parseDate(value: any): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function dateSequenceCheck(input: CheckInput): CheckResult {
  const checkName = 'date-sequence-check';

  const invoiceDate = parseDate(input.invoiceData?.invoiceDate ?? input.invoiceData?.date);
  const shipmentDate = parseDate(input.blData?.shipmentDate ?? input.blData?.dateOfShipment ?? input.processData?.shipmentDate);
  const eta = parseDate(input.blData?.eta ?? input.processData?.eta);
  const etd = parseDate(input.blData?.etd ?? input.processData?.etd);

  const sources: string[] = [];
  if (invoiceDate) sources.push('INV');
  if (shipmentDate || eta || etd) sources.push('BL');
  if (input.processData?.eta || input.processData?.etd || input.processData?.shipmentDate) sources.push('Sistema');

  if (!invoiceDate && !shipmentDate && !eta) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: sources.join(' vs ') || 'N/A',
      message: 'No dates found in documents to validate sequence.',
    };
  }

  const issues: string[] = [];
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  // invoiceDate <= shipmentDate
  if (invoiceDate && shipmentDate && invoiceDate > shipmentDate) {
    issues.push(`Invoice date (${formatDate(invoiceDate)}) is after shipment date (${formatDate(shipmentDate)})`);
  }

  // shipmentDate <= eta
  if (shipmentDate && eta && shipmentDate > eta) {
    issues.push(`Shipment date (${formatDate(shipmentDate)}) is after ETA (${formatDate(eta)})`);
  }

  // invoiceDate should not be in the future
  if (invoiceDate && invoiceDate > today) {
    issues.push(`Invoice date (${formatDate(invoiceDate)}) is in the future`);
  }

  // ETD should not be more than 90 days in the past
  if (etd) {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    if (etd < ninetyDaysAgo) {
      issues.push(`ETD (${formatDate(etd)}) is more than 90 days in the past`);
    }
  }

  const datesSummary: string[] = [];
  if (invoiceDate) datesSummary.push(`INV=${formatDate(invoiceDate)}`);
  if (etd) datesSummary.push(`ETD=${formatDate(etd)}`);
  if (shipmentDate) datesSummary.push(`Ship=${formatDate(shipmentDate)}`);
  if (eta) datesSummary.push(`ETA=${formatDate(eta)}`);

  if (issues.length > 0) {
    return {
      checkName,
      status: 'failed',
      expectedValue: 'INV Date <= Shipment <= ETA, no future dates',
      actualValue: datesSummary.join(', '),
      documentsCompared: sources.join(' vs '),
      message: issues.join('. ') + '.',
    };
  }

  return {
    checkName,
    status: 'passed',
    expectedValue: 'Dates in logical order',
    actualValue: datesSummary.join(', '),
    documentsCompared: sources.join(' vs '),
    message: 'All dates are in correct chronological order.',
  };
}
