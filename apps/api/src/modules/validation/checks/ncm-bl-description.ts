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

  if (!input.invoiceData) {
    return {
      checkName,
      status: 'skipped',
      documentsCompared: 'INV x BL',
      message: 'aguardando INV',
    };
  }

  const items = input.invoiceData?.items as Array<Record<string, any>> | undefined;
  const cargoDescription = input.blData?.cargoDescription ?? '';

  if (!items || items.length === 0) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: 'INV x BL',
      message: 'Nenhum item encontrado na invoice para extrair codigos NCM.',
    };
  }

  if (!cargoDescription) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: 'INV x BL',
      message: 'Nenhuma descricao de carga encontrada nos dados do BL.',
    };
  }

  const ncmPrefixes = new Set<string>();
  for (const item of items) {
    const ncm = String(item.ncmCode ?? item.ncm ?? '').replace(/[.\-\s]/g, '');
    if (ncm.length >= 4) {
      ncmPrefixes.add(ncm.substring(0, 4));
    }
  }

  if (ncmPrefixes.size === 0) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: 'INV x BL',
      message: 'Nenhum codigo NCM valido encontrado nos itens da invoice.',
    };
  }

  const descriptionText = String(cargoDescription);
  const missingPrefixes: string[] = [];

  for (const prefix of ncmPrefixes) {
    if (!descriptionText.includes(prefix)) {
      missingPrefixes.push(prefix);
    }
  }

  if (missingPrefixes.length === 0) {
    return {
      checkName,
      status: 'passed',
      expectedValue: [...ncmPrefixes].join(', '),
      actualValue: 'Todos encontrados no BL',
      documentsCompared: 'INV x BL',
      message: 'Todos os prefixos NCM encontrados na descricao de carga do BL.',
    };
  }

  // NOTE: compara prefixo NCM numerico (4 digitos) contra o texto livre da
  // descricao de carga do BL — o BL raramente cita NCM, entao a ausencia e
  // estrutural e nao indica erro documental real. Rebaixado de 'failed' para
  // 'warning' para nao disparar correcao/alerta critico indevido (#9).
  return {
    checkName,
    status: 'warning',
    expectedValue: [...ncmPrefixes].join(', '),
    actualValue: `Ausentes: ${missingPrefixes.join(', ')}`,
    documentsCompared: 'INV x BL',
    message: `Prefixos NCM nao encontrados na descricao do BL: ${missingPrefixes.join(', ')}.`,
  };
}
