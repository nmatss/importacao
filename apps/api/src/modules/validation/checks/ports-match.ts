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
      documentsCompared: 'INV vs PL vs BL',
      message: 'aguardando INV',
    };
  }

  const invPolRaw = input.invoiceData?.portOfLoading;
  const plPolRaw = input.packingListData?.portOfLoading;
  const blPolRaw = input.blData?.portOfLoading;
  const invPodRaw = input.invoiceData?.portOfDischarge;
  const plPodRaw = input.packingListData?.portOfDischarge;
  const blPodRaw = input.blData?.portOfDischarge;

  const invPortOfLoading = normalizePort(invPolRaw);
  const plPortOfLoading = normalizePort(plPolRaw);
  const blPortOfLoading = normalizePort(blPolRaw);
  const invPortOfDischarge = normalizePort(invPodRaw);
  const plPortOfDischarge = normalizePort(plPodRaw);
  const blPortOfDischarge = normalizePort(blPodRaw);

  if (!invPortOfLoading && !plPortOfLoading && !blPortOfLoading) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: 'INV vs PL vs BL',
      message: 'Porto de embarque nao encontrado em nenhum documento.',
    };
  }

  const issues: string[] = [];
  const loadingEntries = [
    { label: 'INV', raw: invPolRaw, normalized: invPortOfLoading },
    { label: 'PL', raw: plPolRaw, normalized: plPortOfLoading },
    { label: 'BL', raw: blPolRaw, normalized: blPortOfLoading },
  ].filter((entry) => entry.normalized);
  const dischargeEntries = [
    { label: 'INV', raw: invPodRaw, normalized: invPortOfDischarge },
    { label: 'PL', raw: plPodRaw, normalized: plPortOfDischarge },
    { label: 'BL', raw: blPodRaw, normalized: blPortOfDischarge },
  ].filter((entry) => entry.normalized);

  const baseLoading = loadingEntries[0];
  for (const entry of loadingEntries.slice(1)) {
    if (!portsEqual(baseLoading.raw, entry.raw)) {
      issues.push(
        `Porto de embarque: ${baseLoading.label}="${baseLoading.raw}" vs ${entry.label}="${entry.raw}"`,
      );
    }
  }

  const baseDischarge = dischargeEntries[0];
  for (const entry of dischargeEntries.slice(1)) {
    if (!portsEqual(baseDischarge.raw, entry.raw)) {
      issues.push(
        `Porto de descarga: ${baseDischarge.label}="${baseDischarge.raw}" vs ${entry.label}="${entry.raw}"`,
      );
    }
  }

  if (issues.length > 0) {
    return {
      checkName,
      status: 'failed',
      expectedValue: `Loading: ${invPortOfLoading || plPortOfLoading || blPortOfLoading}, Discharge: ${invPortOfDischarge || plPortOfDischarge || blPortOfDischarge}`,
      actualValue: issues.join('; '),
      documentsCompared: 'INV vs PL vs BL',
      message: `Divergencia nos portos: ${issues.join('; ')}`,
    };
  }

  return {
    checkName,
    status: 'passed',
    expectedValue: `Loading: ${invPortOfLoading || plPortOfLoading || blPortOfLoading}, Discharge: ${invPortOfDischarge || plPortOfDischarge || blPortOfDischarge}`,
    actualValue: `Loading: ${[invPortOfLoading, plPortOfLoading, blPortOfLoading].filter(Boolean).join(' / ')}, Discharge: ${[invPortOfDischarge, plPortOfDischarge, blPortOfDischarge].filter(Boolean).join(' / ')}`,
    documentsCompared: 'INV vs PL vs BL',
    message: 'Portos conferem entre os documentos disponiveis.',
  };
}
