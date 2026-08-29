import { normalizePort, portsMatch as portsEqual } from '../utils/port-normalize.js';
import { FIELD_SOURCE_PRECEDENCE, type DocumentSource } from '../utils/source-precedence.js';

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

  if (!invPortOfDischarge && !plPortOfDischarge && !blPortOfDischarge) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: 'INV vs PL vs BL',
      message: 'Porto de descarga nao encontrado em nenhum documento.',
    };
  }

  const issues: string[] = [];
  const loadingEntries = [
    { label: 'INV' as DocumentSource, raw: invPolRaw, normalized: invPortOfLoading },
    { label: 'PL' as DocumentSource, raw: plPolRaw, normalized: plPortOfLoading },
    { label: 'BL' as DocumentSource, raw: blPolRaw, normalized: blPortOfLoading },
  ].filter((entry) => entry.normalized);
  const dischargeEntries = [
    { label: 'INV' as DocumentSource, raw: invPodRaw, normalized: invPortOfDischarge },
    { label: 'PL' as DocumentSource, raw: plPodRaw, normalized: plPortOfDischarge },
    { label: 'BL' as DocumentSource, raw: blPodRaw, normalized: blPortOfDischarge },
  ].filter((entry) => entry.normalized);

  // A referencia era simplesmente a primeira fonte presente na ordem do array.
  // Agora segue a precedencia declarada (BL manda em porto: e o contrato de
  // transporte) e o resultado registra de onde veio o "esperado".
  type PortEntry = (typeof loadingEntries)[number];
  const byPrecedence = (entries: PortEntry[]): PortEntry =>
    FIELD_SOURCE_PRECEDENCE.ports
      .map((source) => entries.find((entry) => entry.label === source))
      .find((entry): entry is PortEntry => entry != null) ?? entries[0];

  const baseLoading = byPrecedence(loadingEntries);
  for (const entry of loadingEntries.filter((candidate) => candidate !== baseLoading)) {
    if (!portsEqual(baseLoading.raw, entry.raw)) {
      issues.push(
        `Porto de embarque: ${baseLoading.label}="${baseLoading.raw}" vs ${entry.label}="${entry.raw}"`,
      );
    }
  }

  const baseDischarge = byPrecedence(dischargeEntries);
  for (const entry of dischargeEntries.filter((candidate) => candidate !== baseDischarge)) {
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
      expectedValue: `Loading: ${baseLoading.normalized} (fonte: ${baseLoading.label}), Discharge: ${baseDischarge.normalized} (fonte: ${baseDischarge.label})`,
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
