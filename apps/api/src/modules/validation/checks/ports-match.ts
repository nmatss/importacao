import { normalizePort, portsMatch as portsEqual } from '../utils/port-normalize.js';

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

export default function portsMatch(input: CheckInput): CheckResult {
  const checkName = 'ports-match';

  if (!input.invoiceData) {
    return {
      checkName,
      status: 'skipped',
      documentsCompared: 'INV vs BL',
      message: 'aguardando INV',
    };
  }

  const invPolRaw = input.invoiceData?.portOfLoading;
  const blPolRaw = input.blData?.portOfLoading;
  const invPodRaw = input.invoiceData?.portOfDischarge;
  const blPodRaw = input.blData?.portOfDischarge;

  const invPortOfLoading = normalizePort(invPolRaw);
  const blPortOfLoading = normalizePort(blPolRaw);
  const invPortOfDischarge = normalizePort(invPodRaw);
  const blPortOfDischarge = normalizePort(blPodRaw);

  if (!invPortOfLoading && !blPortOfLoading) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: 'INV vs BL',
      message: 'Porto de embarque nao encontrado em nenhum documento.',
    };
  }

  const issues: string[] = [];

  if (invPortOfLoading && blPortOfLoading && !portsEqual(invPolRaw, blPolRaw)) {
    issues.push(`Porto de embarque: INV="${invPolRaw}" vs BL="${blPolRaw}"`);
  }

  if (invPortOfDischarge && blPortOfDischarge && !portsEqual(invPodRaw, blPodRaw)) {
    issues.push(`Porto de descarga: INV="${invPodRaw}" vs BL="${blPodRaw}"`);
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
