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

export default function invoiceValueVsFup(input: CheckInput): CheckResult {
  const checkName = 'invoice-value-vs-fup';

  const invoiceFobRaw = input.invoiceData?.totalFobValue != null ? Number(input.invoiceData.totalFobValue) : null;
  const processFobRaw = input.processData?.totalFobValue != null ? Number(input.processData.totalFobValue) : null;
  const invoiceFob = invoiceFobRaw != null && !isNaN(invoiceFobRaw) ? invoiceFobRaw : null;
  const processFob = processFobRaw != null && !isNaN(processFobRaw) ? processFobRaw : null;

  if (processFob == null) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: 'Invoice vs Sistema',
      message: 'Skipped: Valor FOB nao cadastrado no processo.',
    };
  }

  if (invoiceFob == null) {
    return {
      checkName,
      status: 'warning',
      expectedValue: processFob.toFixed(2),
      documentsCompared: 'Invoice vs Sistema',
      message: 'Valor FOB total nao encontrado na Invoice.',
    };
  }

  const difference = Math.abs(invoiceFob - processFob);

  if (difference <= 0.01) {
    return {
      checkName,
      status: 'passed',
      expectedValue: processFob.toFixed(2),
      actualValue: invoiceFob.toFixed(2),
      documentsCompared: 'Invoice vs Sistema',
      message: 'Valor FOB da Invoice confere com o sistema.',
    };
  }

  return {
    checkName,
    status: 'failed',
    expectedValue: processFob.toFixed(2),
    actualValue: invoiceFob.toFixed(2),
    documentsCompared: 'Invoice vs Sistema',
    message: `Divergencia no valor FOB: Invoice=${invoiceFob.toFixed(2)} vs Sistema=${processFob.toFixed(2)} (diff: ${difference.toFixed(2)}).`,
  };
}
