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

export default function currencyCheck(input: CheckInput): CheckResult {
  const checkName = 'currency-check';

  if (!input.invoiceData) {
    return {
      checkName,
      status: 'skipped',
      expectedValue: 'USD',
      documentsCompared: 'INV',
      message: 'aguardando INV',
    };
  }

  const currency = String(input.invoiceData?.currency ?? '')
    .trim()
    .toUpperCase();

  if (!currency) {
    return {
      checkName,
      status: 'warning',
      expectedValue: 'USD',
      documentsCompared: 'INV',
      message: 'Moeda nao encontrada nos dados da invoice.',
    };
  }

  if (currency === 'USD') {
    return {
      checkName,
      status: 'passed',
      expectedValue: 'USD',
      actualValue: currency,
      documentsCompared: 'INV',
      message: 'Moeda da invoice e USD conforme esperado.',
    };
  }

  return {
    checkName,
    status: 'failed',
    expectedValue: 'USD',
    actualValue: currency,
    documentsCompared: 'INV',
    message: `Moeda da invoice e ${currency}, esperado USD.`,
  };
}
