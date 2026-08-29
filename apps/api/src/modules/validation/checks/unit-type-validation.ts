interface CheckInput {
  invoiceData?: Record<string, any>;
  packingListData?: Record<string, any>;
  blData?: Record<string, any>;
  processData?: Record<string, any>;
  followUpData?: Record<string, any>;
}

interface CheckResult {
  checkName: string;
  status: 'passed' | 'failed' | 'warning' | 'skipped';
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

/**
 * Casamento por PALAVRA INTEIRA. O `includes` anterior detectava a keyword no
 * meio de outra palavra: "PARKA JACKET" e "SEPARATE PANTS" viravam PAR, e
 * "CORSET" virava SET — e o check emitia `failed`, que marca o processo em
 * pending_correction, move a pasta no Drive e gera rascunho de e-mail para a
 * KIOM. Fronteira de palavra elimina essa classe inteira de falso positivo.
 */
const UNIT_TYPE_PATTERNS: Array<[string, RegExp[]]> = Object.entries(UNIT_TYPE_KEYWORDS).map(
  ([unitType, keywords]) => [
    unitType,
    keywords.map((kw) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${kw}(?:[^\\p{L}\\p{N}]|$)`, 'iu')),
  ],
);

function detectUnitType(description: string): string {
  for (const [unitType, patterns] of UNIT_TYPE_PATTERNS) {
    if (patterns.some((pattern) => pattern.test(description))) return unitType;
  }
  return 'UN';
}

function normalizeDeclaredUnit(value: unknown): string {
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[.\s_-]/g, '');

  if (!normalized) return '';
  if (
    [
      'UN',
      'UND',
      'UNID',
      'UNIDADE',
      'UNIDADES',
      'UNIT',
      'UNITS',
      'PC',
      'PCS',
      'PCE',
      'PZA',
      'PIECE',
      'PIECES',
    ].includes(normalized)
  ) {
    return 'UN';
  }
  if (['PAR', 'PARES', 'PAIR', 'PAIRS'].includes(normalized)) return 'PAR';
  if (['SET', 'SETS', 'KIT', 'KITS'].includes(normalized)) return 'SET';
  return normalized;
}

export default function unitTypeValidation(input: CheckInput): CheckResult {
  const checkName = 'unit-type-validation';

  if (!input.invoiceData) {
    return {
      checkName,
      status: 'skipped',
      documentsCompared: 'INV',
      message: 'aguardando INV',
    };
  }

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
    const declaredUnit = normalizeDeclaredUnit(item.unitType ?? item.unit);

    if (declaredUnit && declaredUnit !== expectedUnit) {
      mismatches.push(`"${description}": esperado ${expectedUnit}, encontrado ${declaredUnit}`);
    }
  }

  if (plItems && plItems.length > 0) {
    for (const plItem of plItems) {
      const description = plItem.description ?? plItem.productName ?? '';
      if (!description) continue;

      const expectedUnit = detectUnitType(description);
      const declaredUnit = normalizeDeclaredUnit(plItem.unitType ?? plItem.unit);

      if (declaredUnit && declaredUnit !== expectedUnit) {
        mismatches.push(
          `PL "${description}": esperado ${expectedUnit}, encontrado ${declaredUnit}`,
        );
      }
    }
  }

  if (mismatches.length > 0) {
    // `warning`, nao `failed`: a unidade "esperada" e inferida da DESCRICAO por
    // heuristica linguistica, nao lida de um campo do documento. Uma heuristica
    // de texto nao deve, sozinha, marcar pending_correction e disparar e-mail
    // de correcao para fornecedor externo — quem decide isso e o operador.
    return {
      checkName,
      status: 'warning',
      expectedValue: 'Tipos de unidade consistentes',
      actualValue: `${mismatches.length} divergencia(s)`,
      documentsCompared: plItems ? 'INV x PL' : 'INV',
      message: `Possiveis divergencias de tipo de unidade (inferido da descricao, confirme no documento): ${mismatches.join('; ')}.`,
    };
  }

  return {
    checkName,
    status: 'passed',
    documentsCompared: plItems ? 'INV x PL' : 'INV',
    message: 'Tipos de unidade consistentes com as descricoes dos produtos.',
  };
}
