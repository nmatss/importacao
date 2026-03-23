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
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

export default function portsMatch(input: CheckInput): CheckResult {
  const checkName = 'ports-match';

  const invPortOfLoading = normalize(input.invoiceData?.portOfLoading);
  const blPortOfLoading = normalize(input.blData?.portOfLoading);
  const invPortOfDischarge = normalize(input.invoiceData?.portOfDischarge);
  const blPortOfDischarge = normalize(input.blData?.portOfDischarge);

  if (!invPortOfLoading && !blPortOfLoading) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: 'INV vs BL',
      message: 'Porto de embarque nao encontrado em nenhum documento.',
    };
  }

  const issues: string[] = [];

  if (invPortOfLoading && blPortOfLoading && invPortOfLoading !== blPortOfLoading) {
    issues.push(`Porto de embarque: INV="${invPortOfLoading}" vs BL="${blPortOfLoading}"`);
  }

  if (invPortOfDischarge && blPortOfDischarge && invPortOfDischarge !== blPortOfDischarge) {
    issues.push(`Porto de descarga: INV="${invPortOfDischarge}" vs BL="${blPortOfDischarge}"`);
  }

  if (issues.length > 0) {
    return {
      checkName,
      status: 'failed',
      expectedValue: `Loading: ${invPortOfLoading || blPortOfLoading}, Discharge: ${invPortOfDischarge || blPortOfDischarge}`,
      actualValue: issues.join('; '),
      documentsCompared: 'INV vs BL',
      message: `Divergencia nos portos: ${issues.join('; ')}`,
    };
  }

  return {
    checkName,
    status: 'passed',
    expectedValue: `Loading: ${invPortOfLoading || blPortOfLoading}, Discharge: ${invPortOfDischarge || blPortOfDischarge}`,
    actualValue: `Loading: ${blPortOfLoading || invPortOfLoading}, Discharge: ${blPortOfDischarge || invPortOfDischarge}`,
    documentsCompared: 'INV vs BL',
    message: 'Portos conferem entre a invoice e o conhecimento de embarque.',
  };
}
