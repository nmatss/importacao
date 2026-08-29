import { ASSUMED_WEIGHT_UNIT, normalizeWeightUnit } from '../utils/measure-normalize.js';
import { caveatSuffix, collectDocumentNumbers } from '../utils/cross-document-values.js';

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

const TOLERANCE = 0.5;

export default function netWeightMatch(input: CheckInput): CheckResult {
  const checkName = 'net-weight-match';

  if (!input.invoiceData) {
    return {
      checkName,
      status: 'skipped',
      documentsCompared: 'INV vs PL',
      message: 'aguardando INV',
    };
  }

  const collected = collectDocumentNumbers(
    [
      { source: 'INV', value: input.invoiceData?.totalNetWeight },
      { source: 'PL', value: input.packingListData?.totalNetWeight },
    ],
    { normalizeUnit: normalizeWeightUnit, assumedUnit: ASSUMED_WEIGHT_UNIT },
  );

  const invNetWeight = collected.values.find((entry) => entry.source === 'INV')?.value ?? null;
  const plNetWeight = collected.values.find((entry) => entry.source === 'PL')?.value ?? null;

  // Valor que existe no documento mas nao pode ser comparado (ilegivel,
  // ambiguo ou em outra unidade) nunca pode ser reportado como "nao encontrado".
  if (collected.caveats.length > 0 && collected.values.length < 2) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: 'INV vs PL',
      message: `Peso liquido presente nos documentos mas nao comparavel — ${collected.caveats.join('; ')}.`,
    };
  }

  if (invNetWeight == null && plNetWeight == null) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: 'INV vs PL',
      message: 'Peso liquido nao encontrado em nenhum dos documentos.',
    };
  }

  if (invNetWeight == null || plNetWeight == null) {
    return {
      checkName,
      status: 'warning',
      expectedValue: invNetWeight?.toFixed(3) ?? undefined,
      actualValue: plNetWeight?.toFixed(3) ?? undefined,
      documentsCompared: 'INV vs PL',
      message: 'Peso liquido encontrado em apenas um documento, impossivel comparar.',
    };
  }

  const difference = Math.abs(invNetWeight - plNetWeight);

  if (difference <= TOLERANCE) {
    return {
      checkName,
      status: 'passed',
      expectedValue: invNetWeight.toFixed(3),
      actualValue: plNetWeight.toFixed(3),
      documentsCompared: 'INV vs PL',
      message:
        `Peso liquido confere dentro da tolerancia (diff: ${difference.toFixed(3)} kg).` +
        caveatSuffix(collected.caveats),
    };
  }

  return {
    checkName,
    status: 'failed',
    expectedValue: invNetWeight.toFixed(3),
    actualValue: plNetWeight.toFixed(3),
    documentsCompared: 'INV vs PL',
    message:
      `Divergencia no peso liquido: INV=${invNetWeight.toFixed(3)} kg vs PL=${plNetWeight.toFixed(3)} kg (diff: ${difference.toFixed(3)} kg, tolerancia: ${TOLERANCE} kg).` +
      caveatSuffix(collected.caveats),
  };
}
