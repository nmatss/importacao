import {
  FIELD_SOURCE_PRECEDENCE,
  pickPreferred,
  type SourcedValue,
} from '../utils/source-precedence.js';

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
    .toLowerCase()
    .replace(/[-_.\s/]/g, '');
}

export default function processReference(input: CheckInput): CheckResult {
  const checkName = 'process-reference';

  const invRaw = input.invoiceData?.invoiceNumber ?? input.invoiceData?.referenceNumber;
  const plRaw = input.packingListData?.packingListNumber ?? input.packingListData?.referenceNumber;
  // IMPORTANT: do NOT use bl.blNumber here — that's the shipping document ID
  // (e.g. SHYY26021495A), not the customer/process reference.
  const blRaw =
    input.blData?.customerReference ?? input.blData?.orderNumber ?? input.blData?.referenceNumber;

  const invRef = normalize(invRaw);
  const plRef = normalize(plRaw);
  const blRef = normalize(blRaw);

  const entries: Array<SourcedValue<string>> = [];
  if (invRef) entries.push({ source: 'INV', value: invRef });
  if (plRef) entries.push({ source: 'PL', value: plRef });
  if (blRef) entries.push({ source: 'BL', value: blRef });

  const sources = entries.map((entry) => entry.source);
  const values = entries.map((entry) => entry.value);
  // Referencia explicita (Invoice manda na referencia do processo) em vez de
  // "o primeiro documento que por acaso foi extraido".
  const reference = pickPreferred(entries, FIELD_SOURCE_PRECEDENCE.processReference);

  // BL has only blNumber but no customerReference/orderNumber — flag so operator is aware.
  const blHasOnlyBlNumber =
    !blRaw && input.blData?.blNumber != null && String(input.blData.blNumber).trim() !== '';

  if (values.length < 2) {
    if (blHasOnlyBlNumber) {
      return {
        checkName,
        status: 'warning',
        documentsCompared: sources.join(' vs '),
        message:
          'Referência do BL ausente — confirme ORDER NO./PO CUSTOMER REF no documento original.',
      };
    }
    return {
      checkName,
      status: 'warning',
      documentsCompared: sources.join(' vs '),
      message: 'Documentos insuficientes para comparar a referência do processo.',
    };
  }

  const referenceValue = reference!.value;
  const referenceLabel = `${referenceValue} (fonte: ${reference!.source})`;
  const allEqual = values.every((v) => v === referenceValue);
  if (allEqual) {
    if (blHasOnlyBlNumber) {
      return {
        checkName,
        status: 'warning',
        expectedValue: referenceLabel,
        actualValue: referenceValue,
        documentsCompared: sources.join(' vs '),
        message:
          'Referência do BL ausente — confirme ORDER NO./PO CUSTOMER REF no documento original.',
      };
    }
    return {
      checkName,
      status: 'passed',
      expectedValue: referenceLabel,
      actualValue: referenceValue,
      documentsCompared: sources.join(' vs '),
      message: 'Referência do processo consistente em todos os documentos.',
    };
  }

  const divergent = entries.filter((entry) => entry.value !== referenceValue);
  return {
    checkName,
    status: 'failed',
    expectedValue: referenceLabel,
    actualValue: divergent.map((entry) => `${entry.source}=${entry.value}`).join(', '),
    documentsCompared: sources.join(' vs '),
    message: `Referência do processo inconsistente entre os documentos (referência: ${reference!.source}=${referenceValue}).`,
  };
}
