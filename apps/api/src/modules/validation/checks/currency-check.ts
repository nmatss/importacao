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

const CURRENCY_CODE_RE = /\b(USD|EUR|BRL|CNY|RMB|HKD)\b/;

function normalizeCurrency(value: unknown): { raw: string; code: string } {
  const raw = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
  const compact = raw.replace(/[\s.]/g, '');

  if (
    compact === 'USD' ||
    compact === 'US$' ||
    compact === 'U$S' ||
    compact === 'USDS' ||
    raw === 'US DOLLAR' ||
    raw === 'US DOLLARS' ||
    raw === 'UNITED STATES DOLLAR' ||
    raw === 'UNITED STATES DOLLARS' ||
    raw === 'DOLLAR' ||
    raw === 'DOLLARS' ||
    raw === 'DOLAR' ||
    raw === 'DOLARES'
  ) {
    return { raw, code: 'USD' };
  }

  const codeMatch = raw.match(CURRENCY_CODE_RE);
  if (codeMatch) return { raw, code: codeMatch[1] };

  if (raw.includes('US$') || raw.includes('U.S.D')) {
    return { raw, code: 'USD' };
  }

  return { raw, code: raw };
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

  const currency = normalizeCurrency(input.invoiceData?.currency);

  if (!currency.raw) {
    return {
      checkName,
      status: 'warning',
      expectedValue: 'USD',
      documentsCompared: 'INV',
      message: 'Moeda nao encontrada nos dados da invoice.',
    };
  }

  if (currency.code === 'USD') {
    return {
      checkName,
      status: 'passed',
      expectedValue: 'USD',
      actualValue: currency.raw,
      documentsCompared: 'INV',
      message: 'Moeda da invoice e USD conforme esperado.',
    };
  }

  return {
    checkName,
    status: 'failed',
    expectedValue: 'USD',
    actualValue: currency.raw,
    documentsCompared: 'INV',
    message: `Moeda da invoice e ${currency.raw}, esperado USD.`,
  };
}
