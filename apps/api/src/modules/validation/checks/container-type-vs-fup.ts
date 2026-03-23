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

function normalizeContainerType(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

export default function containerTypeVsFup(input: CheckInput): CheckResult {
  const checkName = 'container-type-vs-fup';

  const blContainer = input.blData?.containerType
    ? String(input.blData.containerType).trim()
    : null;
  const processContainer = input.processData?.containerType
    ? String(input.processData.containerType).trim()
    : null;

  if (processContainer == null || processContainer === '') {
    return {
      checkName,
      status: 'warning',
      documentsCompared: 'BL vs Sistema',
      message: 'Ignorado: Tipo de container nao cadastrado no processo.',
    };
  }

  if (blContainer == null || blContainer === '') {
    return {
      checkName,
      status: 'warning',
      expectedValue: processContainer,
      documentsCompared: 'BL vs Sistema',
      message: 'Tipo de container nao encontrado no BL.',
    };
  }

  const normalizedBl = normalizeContainerType(blContainer);
  const normalizedProcess = normalizeContainerType(processContainer);

  if (normalizedBl === normalizedProcess) {
    return {
      checkName,
      status: 'passed',
      expectedValue: processContainer,
      actualValue: blContainer,
      documentsCompared: 'BL vs Sistema',
      message: 'Tipo de container no BL confere com o sistema.',
    };
  }

  return {
    checkName,
    status: 'failed',
    expectedValue: processContainer,
    actualValue: blContainer,
    documentsCompared: 'BL vs Sistema',
    message: `Divergencia no tipo de container: BL="${blContainer}" vs Sistema="${processContainer}".`,
  };
}
