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

export default function importerMatch(input: CheckInput): CheckResult {
  const checkName = 'importer-match';
  const invImporter = normalize(input.invoiceData?.importerName);
  const plImporter = normalize(input.packingListData?.importerName);
  const blImporter = normalize(input.blData?.consigneeName);

  const sources: string[] = [];
  const values: string[] = [];

  if (invImporter) { sources.push('INV'); values.push(invImporter); }
  if (plImporter) { sources.push('PL'); values.push(plImporter); }
  if (blImporter) { sources.push('BL'); values.push(blImporter); }

  if (values.length < 2) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: sources.join(' vs '),
      message: 'Not enough documents to compare importer name.',
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
      message: 'Importer name matches across all documents.',
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
      message: 'Importer name has minor punctuation differences across documents.',
    };
  }

  return {
    checkName,
    status: 'failed',
    expectedValue: values[0],
    actualValue: values.find((v) => v !== values[0]) ?? values[1],
    documentsCompared: sources.join(' vs '),
    message: 'Importer name does not match across documents.',
  };
}
