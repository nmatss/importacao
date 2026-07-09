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

export default function ncmBlDescription(input: CheckInput): CheckResult {
  const checkName = 'ncm-bl-description';

  if (!input.blData) {
    return {
      checkName,
      status: 'skipped',
      documentsCompared: 'OHBL x Espelho',
      message: 'Aguardando OHBL final para validar NCMs.',
    };
  }

  const espelhoItems = readEspelhoItems(input.processData);
  if (espelhoItems.length === 0) {
    return {
      checkName,
      status: 'skipped',
      documentsCompared: 'OHBL x Espelho',
      message: 'Aguardando Espelho com itens para validar NCMs.',
    };
  }

  const espelhoPrefixes = ncmPrefixesFromItems(espelhoItems);
  const blPrefixes = ncmPrefixesFromBl(input.blData);

  if (espelhoPrefixes.size === 0) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: 'OHBL x Espelho',
      message: 'Nenhum codigo NCM valido encontrado nos itens do Espelho.',
    };
  }

  if (blPrefixes.size === 0) {
    return {
      checkName,
      status: 'warning',
      expectedValue: [...espelhoPrefixes].sort().join(', '),
      actualValue: 'OHBL sem NCMs extraidas',
      documentsCompared: 'OHBL x Espelho',
      message: 'Nenhum prefixo NCM valido foi extraido do OHBL final.',
    };
  }

  const missingPrefixes = [...espelhoPrefixes].filter((prefix) => !blPrefixes.has(prefix)).sort();
  const extraBlPrefixes = [...blPrefixes].filter((prefix) => !espelhoPrefixes.has(prefix)).sort();

  if (missingPrefixes.length === 0) {
    return {
      checkName,
      status: 'passed',
      expectedValue: [...espelhoPrefixes].sort().join(', '),
      actualValue: [...blPrefixes].sort().join(', '),
      documentsCompared: 'OHBL x Espelho',
      message: 'Todos os prefixos NCM do Espelho constam no OHBL final.',
    };
  }

  return {
    checkName,
    status: 'failed',
    expectedValue: [...espelhoPrefixes].sort().join(', '),
    actualValue: [...blPrefixes].sort().join(', '),
    documentsCompared: 'OHBL x Espelho',
    message: [
      `Prefixos NCM do Espelho ausentes no OHBL: ${missingPrefixes.join(', ')}.`,
      extraBlPrefixes.length > 0 ? `Prefixos extras no OHBL: ${extraBlPrefixes.join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join(' '),
  };
}

function readEspelhoItems(processData?: Record<string, any>): Array<Record<string, any>> {
  const aiData = processData?.aiExtractedData;
  const espelho = aiData && typeof aiData === 'object' ? aiData.espelho : null;
  if (!espelho || typeof espelho !== 'object') return [];
  const items: unknown[] = Array.isArray(espelho.items) ? espelho.items : [];
  return items.filter((item): item is Record<string, any> =>
    Boolean(item && typeof item === 'object'),
  );
}

function ncmPrefixesFromItems(items: Array<Record<string, any>>): Set<string> {
  const prefixes = new Set<string>();
  for (const item of items) {
    addNcmPrefix(prefixes, item.ncmCode ?? item.ncm ?? item.ncmItem ?? item.classificacaoFiscal);
  }
  return prefixes;
}

function ncmPrefixesFromBl(blData: Record<string, any>): Set<string> {
  const prefixes = new Set<string>();
  const listCandidates = [blData.ncmList, blData.ncms, blData.ncmCodes, blData.ncmPrefixes];
  for (const candidate of listCandidates) {
    if (Array.isArray(candidate)) {
      for (const value of candidate) addNcmPrefix(prefixes, value);
    } else {
      addNcmPrefix(prefixes, candidate);
    }
  }
  return prefixes;
}

function addNcmPrefix(target: Set<string>, value: unknown) {
  if (value == null) return;
  const rawValues = Array.isArray(value) ? value : String(value).split(/[,\n;/|]+/);
  for (const raw of rawValues) {
    const digits = String(raw).replace(/\D/g, '');
    if (digits.length >= 4) target.add(digits.slice(0, 4));
  }
}
