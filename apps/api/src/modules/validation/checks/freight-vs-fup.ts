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

export default function freightVsFup(input: CheckInput): CheckResult {
  const checkName = 'freight-vs-fup';

  const blFreightRaw =
    input.blData?.freightValue != null ? Number(input.blData.freightValue) : null;
  const processFreightRaw =
    input.processData?.freightValue != null ? Number(input.processData.freightValue) : null;
  const blFreight = blFreightRaw != null && !isNaN(blFreightRaw) ? blFreightRaw : null;
  const processFreight =
    processFreightRaw != null && !isNaN(processFreightRaw) ? processFreightRaw : null;

  if (processFreight == null) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: 'BL vs Sistema',
      message: 'Ignorado: Valor do frete nao cadastrado no processo.',
    };
  }

  if (blFreight == null) {
    return {
      checkName,
      status: 'warning',
      expectedValue: processFreight.toFixed(2),
      documentsCompared: 'BL vs Sistema',
      message: 'Valor do frete nao encontrado no BL.',
    };
  }

  const difference = Math.abs(blFreight - processFreight);

  if (difference <= 0.01) {
    return {
      checkName,
      status: 'passed',
      expectedValue: processFreight.toFixed(2),
      actualValue: blFreight.toFixed(2),
      documentsCompared: 'BL vs Sistema',
      message: 'Valor do frete no BL confere com o sistema.',
    };
  }

  return {
    checkName,
    status: 'failed',
    expectedValue: processFreight.toFixed(2),
    actualValue: blFreight.toFixed(2),
    documentsCompared: 'BL vs Sistema',
    message: `Divergencia no frete: BL=${blFreight.toFixed(2)} vs Sistema=${processFreight.toFixed(2)} (diff: ${difference.toFixed(2)}).`,
  };
}
