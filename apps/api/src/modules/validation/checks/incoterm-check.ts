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

const INCOTERM_RE = /\b(EXW|FCA|FAS|FOB|CFR|CIF|CPT|CIP|DAP|DPU|DDP)\b/;

function normalizeIncoterm(value: unknown): { raw: string; code: string } {
  const raw = String(value ?? '').trim();
  const normalized = raw
    .toUpperCase()
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ');
  const match = normalized.match(INCOTERM_RE);
  return { raw: normalized, code: match?.[1] ?? normalized };
}

export default function incotermCheck(input: CheckInput): CheckResult {
  const checkName = 'incoterm-check';

  if (!input.invoiceData) {
    return {
      checkName,
      status: 'skipped',
      expectedValue: 'FOB',
      documentsCompared: 'INV',
      message: 'aguardando INV',
    };
  }

  const incoterm = normalizeIncoterm(input.invoiceData?.incoterm);

  if (!incoterm.raw) {
    return {
      checkName,
      status: 'warning',
      expectedValue: 'FOB',
      documentsCompared: 'INV',
      message: 'Incoterm nao encontrado nos dados da invoice.',
    };
  }

  if (incoterm.code === 'FOB') {
    return {
      checkName,
      status: 'passed',
      expectedValue: 'FOB',
      actualValue: incoterm.raw,
      documentsCompared: 'INV',
      message: 'Incoterm base e FOB conforme esperado.',
    };
  }

  return {
    checkName,
    status: 'failed',
    expectedValue: 'FOB',
    actualValue: incoterm.raw,
    documentsCompared: 'INV',
    message: `Incoterm e ${incoterm.raw}, esperado FOB.`,
  };
}
