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

export default function boxQuantityMatch(input: CheckInput): CheckResult {
  const checkName = 'box-quantity-match';

  const invBoxes =
    input.invoiceData?.totalBoxes != null ? Number(input.invoiceData.totalBoxes) : null;
  const plBoxes =
    input.packingListData?.totalBoxes != null ? Number(input.packingListData.totalBoxes) : null;
  const blRaw = input.blData?.totalBoxes ?? input.blData?.totalPackages;
  const blBoxes = blRaw != null ? Number(blRaw) : null;

  // Sanity: box counts must be integers. Decimals usually mean the extractor confused
  // carton count with CBM (cubagem). Flag as warning before doing the cross-doc compare.
  if (plBoxes != null && !isNaN(plBoxes) && !Number.isInteger(plBoxes)) {
    return {
      checkName,
      status: 'warning',
      expectedValue: String(input.packingListData?.totalBoxes),
      actualValue: String(input.packingListData?.totalBoxes),
      documentsCompared: 'PL',
      message:
        'Quantidade de caixas no Packing List veio com decimal — possível confusão com cubagem (CBM). Verifique o documento original.',
    };
  }
  if (invBoxes != null && !isNaN(invBoxes) && !Number.isInteger(invBoxes)) {
    return {
      checkName,
      status: 'warning',
      expectedValue: String(input.invoiceData?.totalBoxes),
      actualValue: String(input.invoiceData?.totalBoxes),
      documentsCompared: 'INV',
      message:
        'Quantidade de caixas na Invoice veio com decimal — possível confusão com cubagem (CBM). Verifique o documento original.',
    };
  }
  if (blBoxes != null && !isNaN(blBoxes) && !Number.isInteger(blBoxes)) {
    return {
      checkName,
      status: 'warning',
      expectedValue: String(blRaw),
      actualValue: String(blRaw),
      documentsCompared: 'BL',
      message:
        'Quantidade de caixas no BL veio com decimal — possível confusão com cubagem (CBM). Verifique o documento original.',
    };
  }

  const sources: string[] = [];
  const values: number[] = [];

  if (invBoxes != null && !isNaN(invBoxes)) {
    sources.push('INV');
    values.push(invBoxes);
  }
  if (plBoxes != null && !isNaN(plBoxes)) {
    sources.push('PL');
    values.push(plBoxes);
  }
  if (blBoxes != null && !isNaN(blBoxes)) {
    sources.push('BL');
    values.push(blBoxes);
  }

  if (values.length < 2) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: sources.join(' vs '),
      message: 'Documentos insuficientes para comparar quantidade de caixas.',
    };
  }

  const allEqual = values.every((v) => v === values[0]);
  if (allEqual) {
    return {
      checkName,
      status: 'passed',
      expectedValue: String(values[0]),
      actualValue: String(values[0]),
      documentsCompared: sources.join(' vs '),
      message: 'Total de caixas confere em todos os documentos.',
    };
  }

  const details = sources.map((s, i) => `${s}=${values[i]}`).join(', ');
  return {
    checkName,
    status: 'failed',
    expectedValue: String(values[0]),
    actualValue: values.find((v) => v !== values[0])?.toString() ?? String(values[1]),
    documentsCompared: sources.join(' vs '),
    message: `Divergencia na quantidade de caixas: ${details}.`,
  };
}
