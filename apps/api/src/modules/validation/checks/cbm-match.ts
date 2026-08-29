import { ASSUMED_VOLUME_UNIT, normalizeVolumeUnit } from '../utils/measure-normalize.js';
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

const TOLERANCE = 0.1;

export default function cbmMatch(input: CheckInput): CheckResult {
  const checkName = 'cbm-match';

  // O fallback `blData.totalVolume` foi removido: nenhum schema de extracao
  // produz esse campo, e "volume" no vocabulario de BL/PL brasileiro significa
  // VOLUMES (quantidade de caixas), nao cubagem. Tratar os dois como a mesma
  // grandeza podia comparar m3 contra contagem de caixas.
  const collected = collectDocumentNumbers(
    [
      { source: 'INV', value: input.invoiceData?.totalCbm },
      { source: 'PL', value: input.packingListData?.totalCbm },
      { source: 'BL', value: input.blData?.totalCbm },
    ],
    { normalizeUnit: normalizeVolumeUnit, assumedUnit: ASSUMED_VOLUME_UNIT },
  );

  const documentsCompared = collected.values.map((entry) => entry.source).join(' vs ');

  if (collected.values.length < 2) {
    return {
      checkName,
      status: 'warning',
      documentsCompared,
      message:
        collected.caveats.length > 0
          ? `CBM presente nos documentos mas nao comparavel — ${collected.caveats.join('; ')}.`
          : 'Documentos insuficientes para comparar CBM.',
    };
  }

  const reference = pickPreferred(collected.values, FIELD_SOURCE_PRECEDENCE.cbm)!;
  const maxDiff = Math.max(
    ...collected.values.map((entry) => Math.abs(entry.value - reference.value)),
  );
  const details = collected.values
    .map((entry) => `${entry.source}=${entry.value.toFixed(3)}`)
    .join(', ');

  if (maxDiff <= TOLERANCE) {
    return {
      checkName,
      status: 'passed',
      expectedValue: `${reference.value.toFixed(3)} (fonte: ${reference.source})`,
      actualValue: details,
      documentsCompared,
      message:
        `CBM confere entre os documentos dentro da tolerancia (referencia: ${reference.source}, diff max: ${maxDiff.toFixed(3)}).` +
        caveatSuffix(collected.caveats),
    };
  }

  return {
    checkName,
    status: 'failed',
    expectedValue: `${reference.value.toFixed(3)} (fonte: ${reference.source})`,
    actualValue: details,
    documentsCompared,
    message:
      `Divergencia no CBM: ${details} (referencia: ${reference.source}, diff max: ${maxDiff.toFixed(3)}, tolerancia: ${TOLERANCE}).` +
      caveatSuffix(collected.caveats),
  };
}
