import { ASSUMED_WEIGHT_UNIT, normalizeWeightUnit } from '../utils/measure-normalize.js';
import { caveatSuffix, collectDocumentNumbers } from '../utils/cross-document-values.js';
import { FIELD_SOURCE_PRECEDENCE, pickPreferred } from '../utils/source-precedence.js';

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

const TOLERANCE = 0.5;
const UNIT_OPTIONS = { normalizeUnit: normalizeWeightUnit, assumedUnit: ASSUMED_WEIGHT_UNIT };

export default function grossWeightMatch(input: CheckInput): CheckResult {
  const checkName = 'gross-weight-match';

  const gross = collectDocumentNumbers(
    [
      { source: 'INV', value: input.invoiceData?.totalGrossWeight },
      { source: 'PL', value: input.packingListData?.totalGrossWeight },
      { source: 'BL', value: input.blData?.totalGrossWeight },
    ],
    UNIT_OPTIONS,
  );
  const net = collectDocumentNumbers(
    [
      { source: 'INV', value: input.invoiceData?.totalNetWeight },
      { source: 'PL', value: input.packingListData?.totalNetWeight },
    ],
    UNIT_OPTIONS,
  );

  const documentsCompared = gross.values.map((entry) => entry.source).join(' vs ');
  const caveats = [...gross.caveats, ...net.caveats];

  if (gross.values.length < 2) {
    // "Nao veio" e "veio ilegivel" sao coisas diferentes e a mensagem tem de
    // dizer qual das duas aconteceu.
    return {
      checkName,
      status: 'warning',
      documentsCompared,
      message:
        caveats.length > 0
          ? `Peso bruto presente nos documentos mas nao comparavel — ${caveats.join('; ')}.`
          : 'Documentos insuficientes para comparar peso bruto.',
    };
  }

  // Bruto > liquido: comparacao valida dentro do MESMO documento. Quando nenhum
  // documento traz os dois pesos, comparamos as referencias de cada campo mas
  // sem emitir `failed` — misturar fontes nao sustenta um e-mail de correcao.
  const sameDocPair = FIELD_SOURCE_PRECEDENCE.grossWeight
    .map((source) => ({
      source,
      gross: gross.values.find((entry) => entry.source === source),
      net: net.values.find((entry) => entry.source === source),
    }))
    .find((entry) => entry.gross && entry.net);

  const grossRef = pickPreferred(gross.values, FIELD_SOURCE_PRECEDENCE.grossWeight)!;
  const netRef = pickPreferred(net.values, FIELD_SOURCE_PRECEDENCE.netWeight);

  if (sameDocPair) {
    const grossValue = sameDocPair.gross!.value;
    const netValue = sameDocPair.net!.value;
    if (grossValue <= netValue) {
      return {
        checkName,
        status: 'failed',
        expectedValue: `Gross > Net (net: ${netValue.toFixed(3)} kg, fonte: ${sameDocPair.source})`,
        actualValue: `Gross: ${grossValue.toFixed(3)} kg (fonte: ${sameDocPair.source})`,
        documentsCompared,
        message:
          `Peso bruto (${grossValue.toFixed(3)} kg) nao e maior que o peso liquido (${netValue.toFixed(3)} kg) no documento ${sameDocPair.source}.` +
          caveatSuffix(caveats),
      };
    }
  } else if (netRef && grossRef.value <= netRef.value) {
    return {
      checkName,
      status: 'warning',
      expectedValue: `Gross > Net (net: ${netRef.value.toFixed(3)} kg, fonte: ${netRef.source})`,
      actualValue: `Gross: ${grossRef.value.toFixed(3)} kg (fonte: ${grossRef.source})`,
      documentsCompared,
      message:
        `Peso bruto (${grossRef.source}=${grossRef.value.toFixed(3)} kg) nao e maior que o peso liquido (${netRef.source}=${netRef.value.toFixed(3)} kg), mas os valores vem de documentos diferentes — confirme no documento original.` +
        caveatSuffix(caveats),
    };
  }

  const maxDiff = Math.max(...gross.values.map((entry) => Math.abs(entry.value - grossRef.value)));
  const details = gross.values
    .map((entry) => `${entry.source}=${entry.value.toFixed(3)}`)
    .join(', ');

  if (maxDiff <= TOLERANCE) {
    return {
      checkName,
      status: 'passed',
      expectedValue: `${grossRef.value.toFixed(3)} (fonte: ${grossRef.source})`,
      actualValue: details,
      documentsCompared,
      message:
        `Peso bruto confere entre os documentos dentro da tolerancia (referencia: ${grossRef.source}, dif. max: ${maxDiff.toFixed(3)} kg).` +
        caveatSuffix(caveats),
    };
  }

  return {
    checkName,
    status: 'failed',
    expectedValue: `${grossRef.value.toFixed(3)} (fonte: ${grossRef.source})`,
    actualValue: details,
    documentsCompared,
    message:
      `Divergencia no peso bruto: ${details} (referencia: ${grossRef.source}, dif. max: ${maxDiff.toFixed(3)} kg, tolerancia: ${TOLERANCE} kg).` +
      caveatSuffix(caveats),
  };
}
