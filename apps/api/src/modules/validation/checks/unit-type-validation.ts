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

const UNIT_TYPE_KEYWORDS: Record<string, string[]> = {
  PAR: [
    'meia',
    'meias',
    'sock',
    'socks',
    'par',
    'pair',
    'luva',
    'luvas',
    'glove',
    'gloves',
    'sapato',
    'sapatos',
    'shoe',
    'shoes',
  ],
  SET: ['kit', 'kits', 'set', 'sets', 'conjunto', 'conjuntos'],
};

function detectUnitType(description: string): string {
  const lower = description.toLowerCase();
  for (const [unitType, keywords] of Object.entries(UNIT_TYPE_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) return unitType;
  }
  return 'UN';
}

export default function unitTypeValidation(input: CheckInput): CheckResult {
  const checkName = 'unit-type-validation';
  const invoiceItems = input.invoiceData?.items as Array<Record<string, any>> | undefined;

  if (!invoiceItems || invoiceItems.length === 0) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: 'INV',
      message: 'Nenhum item encontrado na invoice para validar tipos de unidade.',
    };
  }

  const mismatches: string[] = [];
  const plItems = input.packingListData?.items as Array<Record<string, any>> | undefined;

  for (const item of invoiceItems) {
    const description = item.description ?? item.productName ?? '';
    if (!description) continue;

    const expectedUnit = detectUnitType(description);
    const declaredUnit = (item.unitType ?? item.unit ?? '').toUpperCase();

    if (declaredUnit && declaredUnit !== expectedUnit) {
      mismatches.push(`"${description}": esperado ${expectedUnit}, encontrado ${declaredUnit}`);
    }
  }

  if (plItems && plItems.length > 0) {
    for (const plItem of plItems) {
      const description = plItem.description ?? plItem.productName ?? '';
      if (!description) continue;

      const expectedUnit = detectUnitType(description);
      const declaredUnit = (plItem.unitType ?? plItem.unit ?? '').toUpperCase();

      if (declaredUnit && declaredUnit !== expectedUnit) {
        mismatches.push(
          `PL "${description}": esperado ${expectedUnit}, encontrado ${declaredUnit}`,
        );
      }
    }
  }

  if (mismatches.length > 0) {
    return {
      checkName,
      status: 'failed',
      expectedValue: 'Tipos de unidade consistentes',
      actualValue: `${mismatches.length} divergencia(s)`,
      documentsCompared: plItems ? 'INV x PL' : 'INV',
      message: `Divergencias de tipo de unidade encontradas: ${mismatches.join('; ')}.`,
    };
  }

  return {
    checkName,
    status: 'passed',
    documentsCompared: plItems ? 'INV x PL' : 'INV',
    message: 'Tipos de unidade consistentes com as descricoes dos produtos.',
  };
}
