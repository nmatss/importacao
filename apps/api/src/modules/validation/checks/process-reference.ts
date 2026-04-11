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
  const plRaw =
    input.packingListData?.packingListNumber ?? input.packingListData?.referenceNumber;
  // IMPORTANT: do NOT use bl.blNumber here — that's the shipping document ID
  // (e.g. SHYY26021495A), not the customer/process reference.
  const blRaw =
    input.blData?.customerReference ??
    input.blData?.orderNumber ??
    input.blData?.referenceNumber;

  const invRef = normalize(invRaw);
  const plRef = normalize(plRaw);
  const blRef = normalize(blRaw);

  const sources: string[] = [];
  const values: string[] = [];

  if (invRef) {
    sources.push('INV');
    values.push(invRef);
  }
  if (plRef) {
    sources.push('PL');
    values.push(plRef);
  }
  if (blRef) {
    sources.push('BL');
    values.push(blRef);
  }

  // BL has only blNumber but no customerReference/orderNumber — flag so operator is aware.
  const blHasOnlyBlNumber =
    !blRaw && (input.blData?.blNumber != null && String(input.blData.blNumber).trim() !== '');

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

  const allEqual = values.every((v) => v === values[0]);
  if (allEqual) {
    if (blHasOnlyBlNumber) {
      return {
        checkName,
        status: 'warning',
        expectedValue: values[0],
        actualValue: values[0],
        documentsCompared: sources.join(' vs '),
        message:
          'Referência do BL ausente — confirme ORDER NO./PO CUSTOMER REF no documento original.',
      };
    }
    return {
      checkName,
      status: 'passed',
      expectedValue: values[0],
      actualValue: values[0],
      documentsCompared: sources.join(' vs '),
      message: 'Referência do processo consistente em todos os documentos.',
    };
  }

  return {
    checkName,
    status: 'failed',
    expectedValue: values[0],
    actualValue: values.find((v) => v !== values[0]) ?? values[1],
    documentsCompared: sources.join(' vs '),
    message: 'Referência do processo inconsistente entre os documentos.',
  };
}
