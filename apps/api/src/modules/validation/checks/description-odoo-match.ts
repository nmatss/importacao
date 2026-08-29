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
  let comparableCount = 0;
  const unavailable: string[] = [];

  for (const item of items) {
    const code = String(item.itemCode || item.item_code || '').trim();
    const description = String(item.description || '').trim();

    if (!code || !description) continue;
    comparableCount++;

    try {
      const result = await odooService.validateDescription(code, description);
      checkedCount++;

      if (!result.isValid) {
        mismatches.push(
          `${code}: Invoice="${description}" vs Odoo="${result.odooDescription || 'não encontrado'}"`,
        );
      }
    } catch {
      // Falha de consulta ao Odoo NAO pode sumir: o item nao foi verificado, e
      // dizer "todas as N descrições correspondem" sobre um N reduzido e falso.
      unavailable.push(code);
    }
  }

  const coverage = `${checkedCount} de ${comparableCount} verificadas${
    unavailable.length > 0
      ? `, ${unavailable.length} indisponíveis (${unavailable.join(', ')})`
      : ''
  }`;

  if (comparableCount === 0) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: 'INV vs Odoo',
      message: 'Nenhum item com código válido para verificar no Odoo.',
    };
  }

  if (checkedCount === 0) {
    return {
      checkName,
      status: 'warning',
      expectedValue: `${comparableCount} itens a verificar`,
      actualValue: coverage,
      documentsCompared: 'INV vs Odoo',
      message: `Nenhuma descrição pôde ser verificada: o Odoo não respondeu para os ${unavailable.length} item(ns) consultados.`,
    };
  }

  if (mismatches.length === 0) {
    return {
      checkName,
      status: unavailable.length > 0 ? 'warning' : 'passed',
      expectedValue: `${comparableCount} itens a verificar`,
      actualValue: coverage,
      documentsCompared: 'INV vs Odoo',
      message:
        unavailable.length > 0
          ? `${coverage}: as verificadas correspondem ao catálogo Odoo, as indisponíveis não foram conferidas.`
          : `Todas as ${checkedCount} descrições correspondem ao catálogo Odoo.`,
    };
  }

  return {
    checkName,
    status: 'failed',
    expectedValue: coverage,
    actualValue: `${mismatches.length} divergências`,
    documentsCompared: 'INV vs Odoo',
    message: `Divergências encontradas (${coverage}): ${mismatches.join('; ')}`,
  };
}
