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

const SOURCE_LABELS: Record<string, string> = {
  INV: 'na Invoice',
  PL: 'no Packing List',
  BL: 'no BL',
};

export default function boxQuantityMatch(input: CheckInput): CheckResult {
  const checkName = 'box-quantity-match';

  const collected = collectDocumentNumbers([
    { source: 'INV', value: input.invoiceData?.totalBoxes },
    { source: 'PL', value: input.packingListData?.totalBoxes },
    { source: 'BL', value: input.blData?.totalBoxes ?? input.blData?.totalPackages },
  ]);

  const documentsCompared = collected.values.map((entry) => entry.source).join(' vs ');

  // Sanity: box counts must be integers. Decimals usually mean the extractor confused
  // carton count with CBM (cubagem). Flag as warning before doing the cross-doc compare.
  const decimal = FIELD_SOURCE_PRECEDENCE.boxes
    .map((source) => collected.values.find((entry) => entry.source === source))
    .find((entry) => entry && !Number.isInteger(entry.value));
  if (decimal) {
    return {
      checkName,
      status: 'warning',
      expectedValue: String(decimal.value),
      actualValue: String(decimal.value),
      documentsCompared: decimal.source,
      message: `Quantidade de caixas ${SOURCE_LABELS[decimal.source]} veio com decimal — possível confusão com cubagem (CBM). Verifique o documento original.`,
    };
  }

  if (collected.values.length < 2) {
    return {
      checkName,
      status: 'warning',
      documentsCompared,
      message:
        collected.caveats.length > 0
          ? `Quantidade de caixas presente nos documentos mas nao comparavel — ${collected.caveats.join('; ')}.`
          : 'Documentos insuficientes para comparar quantidade de caixas.',
    };
  }

  const reference = pickPreferred(collected.values, FIELD_SOURCE_PRECEDENCE.boxes)!;
  const divergent = collected.values.filter((entry) => entry.value !== reference.value);

  if (divergent.length === 0) {
    return {
      checkName,
      status: 'passed',
      expectedValue: `${reference.value} (fonte: ${reference.source})`,
      actualValue: String(reference.value),
      documentsCompared,
      message: 'Total de caixas confere em todos os documentos.' + caveatSuffix(collected.caveats),
    };
  }

  const details = collected.values.map((entry) => `${entry.source}=${entry.value}`).join(', ');
  return {
    checkName,
    status: 'failed',
    expectedValue: `${reference.value} (fonte: ${reference.source})`,
    actualValue: String(divergent[0].value),
    documentsCompared,
    message:
      `Divergencia na quantidade de caixas: ${details} (referencia: ${reference.source}).` +
      caveatSuffix(collected.caveats),
  };
}
