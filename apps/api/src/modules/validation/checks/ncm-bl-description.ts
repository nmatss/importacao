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

export default function ncmBlDescription(input: CheckInput): CheckResult {
  const checkName = 'ncm-bl-description';
  const items = input.invoiceData?.items as Array<Record<string, any>> | undefined;
  const cargoDescription = input.blData?.cargoDescription?.value ?? input.blData?.cargoDescription ?? '';

  if (!items || items.length === 0) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: 'INV x BL',
      message: 'No invoice items found to extract NCM codes.',
    };
  }

  if (!cargoDescription) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: 'INV x BL',
      message: 'No cargo description found in BL data.',
    };
  }

  const ncmPrefixes = new Set<string>();
  for (const item of items) {
    const ncm = String(item.ncmCode ?? item.ncm ?? '').replace(/[.\-\s]/g, '');
    if (ncm.length >= 4) {
      ncmPrefixes.add(ncm.substring(0, 4));
    }
  }

  if (ncmPrefixes.size === 0) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: 'INV x BL',
      message: 'No valid NCM codes found in invoice items.',
    };
  }

  const descriptionText = String(cargoDescription);
  const missingPrefixes: string[] = [];

  for (const prefix of ncmPrefixes) {
    if (!descriptionText.includes(prefix)) {
      missingPrefixes.push(prefix);
    }
  }

  if (missingPrefixes.length === 0) {
    return {
      checkName,
      status: 'passed',
      expectedValue: [...ncmPrefixes].join(', '),
      actualValue: 'All found in BL',
      documentsCompared: 'INV x BL',
      message: 'All NCM prefixes found in BL cargo description.',
    };
  }

  return {
    checkName,
    status: 'failed',
    expectedValue: [...ncmPrefixes].join(', '),
    actualValue: `Missing: ${missingPrefixes.join(', ')}`,
    documentsCompared: 'INV x BL',
    message: `NCM prefixes not found in BL description: ${missingPrefixes.join(', ')}.`,
  };
}
