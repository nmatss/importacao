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
      message: 'No invoice data available to check manufacturer information.',
    };
  }

  const hasName = !!invoice.manufacturerName;
  const hasAddress = !!invoice.manufacturerAddress;
  const items = invoice.items as Array<Record<string, any>> | undefined;

  const itemManufacturers = items
    ?.map(item => item.manufacturer ?? item.manufacturerName ?? '')
    .filter(Boolean) ?? [];

  const uniqueManufacturers = [...new Set(itemManufacturers)];

  if (!hasName && !hasAddress && uniqueManufacturers.length === 0) {
    return {
      checkName,
      status: 'failed',
      expectedValue: 'Manufacturer name and address',
      actualValue: 'None found',
      documentsCompared: 'INV',
      message: 'No manufacturer information found in invoice.',
    };
  }

  const issues: string[] = [];
  if (!hasName) issues.push('manufacturer name missing');
  if (!hasAddress) issues.push('manufacturer address missing');

  if (items && items.length > 0 && itemManufacturers.length < items.length) {
    issues.push(`${items.length - itemManufacturers.length} item(s) without manufacturer`);
  }

  if (issues.length > 0) {
    return {
      checkName,
      status: 'warning',
      expectedValue: 'Complete manufacturer info',
      actualValue: issues.join(', '),
      documentsCompared: 'INV',
      message: `Partial manufacturer information: ${issues.join('; ')}.`,
    };
  }

  return {
    checkName,
    status: 'passed',
    documentsCompared: 'INV',
    message: `Manufacturer information complete${uniqueManufacturers.length > 1 ? ` (${uniqueManufacturers.length} manufacturers found)` : ''}.`,
  };
}
