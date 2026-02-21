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

export default function currencyCheck(input: CheckInput): CheckResult {
  const checkName = 'currency-check';
  const currency = String(input.invoiceData?.currency ?? '').trim().toUpperCase();

  if (!currency) {
    return {
      checkName,
      status: 'warning',
      expectedValue: 'USD',
      documentsCompared: 'INV',
      message: 'Currency not found in invoice data.',
    };
  }

  if (currency === 'USD') {
    return {
      checkName,
      status: 'passed',
      expectedValue: 'USD',
      actualValue: currency,
      documentsCompared: 'INV',
      message: 'Invoice currency is USD as expected.',
    };
  }

  return {
    checkName,
    status: 'failed',
    expectedValue: 'USD',
    actualValue: currency,
    documentsCompared: 'INV',
    message: `Invoice currency is ${currency}, expected USD.`,
  };
}
