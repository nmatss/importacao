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

export default function manufacturerCompleteness(input: CheckInput): CheckResult {
  const checkName = 'manufacturer-completeness';
  const invoice = input.invoiceData;

  if (!invoice) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: 'INV',
      message: 'Dados da invoice indisponiveis para verificar informacoes do fabricante.',
    };
  }

  const hasName = !!invoice.manufacturerName;
  const hasAddress = !!invoice.manufacturerAddress;
  const items = invoice.items as Array<Record<string, any>> | undefined;

  const itemManufacturers =
    items?.map((item) => item.manufacturer ?? item.manufacturerName ?? '').filter(Boolean) ?? [];

  const uniqueManufacturers = [...new Set(itemManufacturers)];

  if (!hasName && !hasAddress && uniqueManufacturers.length === 0) {
    return {
      checkName,
      status: 'failed',
      expectedValue: 'Nome e endereco do fabricante',
      actualValue: 'Nenhum encontrado',
      documentsCompared: 'INV',
      message: 'Nenhuma informacao do fabricante encontrada na invoice.',
    };
  }

  const issues: string[] = [];
  if (!hasName) issues.push('nome do fabricante ausente');
  if (!hasAddress) issues.push('endereco do fabricante ausente');

  if (items && items.length > 0 && itemManufacturers.length < items.length) {
    issues.push(`${items.length - itemManufacturers.length} item(ns) sem fabricante`);
  }

  if (issues.length > 0) {
    return {
      checkName,
      status: 'warning',
      expectedValue: 'Informacoes completas do fabricante',
      actualValue: issues.join(', '),
      documentsCompared: 'INV',
      message: `Informacoes parciais do fabricante: ${issues.join('; ')}.`,
    };
  }

  return {
    checkName,
    status: 'passed',
    documentsCompared: 'INV',
    message: `Informacoes do fabricante completas${uniqueManufacturers.length > 1 ? ` (${uniqueManufacturers.length} fabricantes encontrados)` : ''}.`,
  };
}
