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

export default function incotermCheck(input: CheckInput): CheckResult {
  const checkName = 'incoterm-check';
  const incoterm = String(input.invoiceData?.incoterm ?? '')
    .trim()
    .toUpperCase();

  if (!incoterm) {
    return {
      checkName,
      status: 'warning',
      expectedValue: 'FOB',
      documentsCompared: 'INV',
      message: 'Incoterm nao encontrado nos dados da invoice.',
    };
  }

  if (incoterm === 'FOB') {
    return {
      checkName,
      status: 'passed',
      expectedValue: 'FOB',
      actualValue: incoterm,
      documentsCompared: 'INV',
      message: 'Incoterm e FOB conforme esperado.',
    };
  }

  return {
    checkName,
    status: 'failed',
    expectedValue: 'FOB',
    actualValue: incoterm,
    documentsCompared: 'INV',
    message: `Incoterm e ${incoterm}, esperado FOB.`,
  };
}
