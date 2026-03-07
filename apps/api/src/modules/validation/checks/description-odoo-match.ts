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

export default async function descriptionOdooMatch(input: CheckInput): Promise<CheckResult> {
  const checkName = 'description-odoo-match';

  const { odooService } = await import('../../integrations/odoo.service.js');

  const configured = await odooService.isConfigured();
  if (!configured) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: 'INV vs Odoo',
      message: 'Odoo não configurado. Verificação de descrições ignorada.',
    };
  }

  const items = input.invoiceData?.items as Array<Record<string, any>> | undefined;
  if (!items || items.length === 0) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: 'INV vs Odoo',
      message: 'Nenhum item encontrado na invoice para verificar no Odoo.',
    };
  }

  const mismatches: string[] = [];
  let checkedCount = 0;

  for (const item of items) {
    const code = String(item.itemCode || item.item_code || '').trim();
    const description = String(item.description || '').trim();

    if (!code || !description) continue;

    try {
      const result = await odooService.validateDescription(code, description);
      checkedCount++;

      if (!result.isValid) {
        mismatches.push(
          `${code}: Invoice="${description}" vs Odoo="${result.odooDescription || 'não encontrado'}"`,
        );
      }
    } catch {
      // Skip individual item errors
    }
  }

  if (checkedCount === 0) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: 'INV vs Odoo',
      message: 'Nenhum item com código válido para verificar no Odoo.',
    };
  }

  if (mismatches.length === 0) {
    return {
      checkName,
      status: 'passed',
      expectedValue: `${checkedCount} itens verificados`,
      actualValue: `${checkedCount} correspondências`,
      documentsCompared: 'INV vs Odoo',
      message: `Todas as ${checkedCount} descrições correspondem ao catálogo Odoo.`,
    };
  }

  return {
    checkName,
    status: 'failed',
    expectedValue: `${checkedCount} correspondências`,
    actualValue: `${mismatches.length} divergências`,
    documentsCompared: 'INV vs Odoo',
    message: `Divergências encontradas: ${mismatches.join('; ')}`,
  };
}
