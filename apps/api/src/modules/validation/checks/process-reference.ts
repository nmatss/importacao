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

export default function processReference(input: CheckInput): CheckResult {
  const checkName = 'process-reference';
  const invRef = normalize(input.invoiceData?.referenceNumber ?? input.invoiceData?.invoiceNumber);
  const plRef = normalize(
    input.packingListData?.referenceNumber ?? input.packingListData?.packingListNumber,
  );
  const blRef = normalize(input.blData?.referenceNumber ?? input.blData?.blNumber);

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

  if (values.length < 2) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: sources.join(' vs '),
      message: 'Documentos insuficientes para comparar a referencia do processo.',
    };
  }

  const allEqual = values.every((v) => v === values[0]);
  if (allEqual) {
    return {
      checkName,
      status: 'passed',
      expectedValue: values[0],
      actualValue: values[0],
      documentsCompared: sources.join(' vs '),
      message: 'Referencia do processo consistente em todos os documentos.',
    };
  }

  return {
    checkName,
    status: 'failed',
    expectedValue: values[0],
    actualValue: values.find((v) => v !== values[0]) ?? values[1],
    documentsCompared: sources.join(' vs '),
    message: 'Referencia do processo inconsistente entre os documentos.',
  };
}
