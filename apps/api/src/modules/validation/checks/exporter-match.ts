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
  return String(value ?? '').trim().toLowerCase();
}

function stripPunctuation(value: string): string {
  return value.replace(/[.,;:\-()]/g, '');
}

export default function exporterMatch(input: CheckInput): CheckResult {
  const checkName = 'exporter-match';
  const invExporter = normalize(input.invoiceData?.exporterName);
  const plExporter = normalize(input.packingListData?.exporterName);
  const blExporter = normalize(input.blData?.shipperName);

  const sources: string[] = [];
  const values: string[] = [];

  if (invExporter) { sources.push('INV'); values.push(invExporter); }
  if (plExporter) { sources.push('PL'); values.push(plExporter); }
  if (blExporter) { sources.push('BL'); values.push(blExporter); }

  if (values.length < 2) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: sources.join(' vs '),
      message: 'Not enough documents to compare exporter name.',
    };
  }

  const allEqual = values.every((v) => v === values[0]);
  if (allEqual) {
    return {
      checkName,
      status: 'passed',
      expectedValue: values[0],
      actualValue: values[0],
      documentsCompared: sources.join(' vs '),
      message: 'Exporter name matches across all documents.',
    };
  }

  const stripped = values.map(stripPunctuation);
  const minorDifference = stripped.every((v) => v === stripped[0]);

  if (minorDifference) {
    return {
      checkName,
      status: 'warning',
      expectedValue: values[0],
      actualValue: values.find((v) => v !== values[0]) ?? values[1],
      documentsCompared: sources.join(' vs '),
      message: 'Exporter name has minor punctuation differences across documents.',
    };
  }

  return {
    checkName,
    status: 'failed',
    expectedValue: values[0],
    actualValue: values.find((v) => v !== values[0]) ?? values[1],
    documentsCompared: sources.join(' vs '),
    message: 'Exporter name does not match across documents.',
  };
}
