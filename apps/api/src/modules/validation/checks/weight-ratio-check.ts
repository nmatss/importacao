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

const MIN_ITEM_RATIO = 1.01;
const MAX_ITEM_RATIO = 3.0;
const MIN_TOTAL_RATIO = 1.05;
const MAX_TOTAL_RATIO = 2.5;

export default function weightRatioCheck(input: CheckInput): CheckResult {
  const checkName = 'weight-ratio-check';

  // Use packing list items first, fall back to invoice items
  const items = (input.packingListData?.items ?? input.invoiceData?.items) as
    | Array<Record<string, any>>
    | undefined;

  const totalGross = Number(
    input.packingListData?.totalGrossWeight ?? input.invoiceData?.totalGrossWeight ?? 0,
  );
  const totalNet = Number(
    input.packingListData?.totalNetWeight ?? input.invoiceData?.totalNetWeight ?? 0,
  );

  if ((!items || items.length === 0) && (!totalGross || !totalNet)) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: 'INV / PL',
      message: 'Nenhum dado de peso encontrado para validar as proporcoes.',
    };
  }

  const issues: string[] = [];
  const warnings: string[] = [];

  // Check individual item ratios
  if (items && items.length > 0) {
    let equalWeightCount = 0;
    let impossibleCount = 0;
    let suspiciousCount = 0;

    for (const item of items) {
      const gross = Number(item.grossWeight ?? 0);
      const net = Number(item.netWeight ?? 0);
      const code = String(item.itemCode ?? item.code ?? 'unknown');

      if (gross <= 0 || net <= 0) continue;

      if (gross < net) {
        impossibleCount++;
        issues.push(`Item ${code}: gross (${gross}) < net (${net})`);
      } else if (gross === net) {
        equalWeightCount++;
      } else {
        const ratio = gross / net;
        if (ratio < MIN_ITEM_RATIO || ratio > MAX_ITEM_RATIO) {
          suspiciousCount++;
          warnings.push(`Item ${code}: ratio=${ratio.toFixed(2)}`);
        }
      }
    }

    if (equalWeightCount > 0) {
      warnings.push(`${equalWeightCount} item(ns) com peso bruto igual ao peso liquido`);
    }

    if (impossibleCount > 0) {
      issues.push(`${impossibleCount} item(ns) com peso bruto menor que o peso liquido`);
    }

    if (suspiciousCount > 0) {
      warnings.push(
        `${suspiciousCount} item(ns) com proporcao bruto/liquido incomum (fora de ${MIN_ITEM_RATIO}-${MAX_ITEM_RATIO})`,
      );
    }
  }

  // Check aggregate ratio
  if (totalGross > 0 && totalNet > 0) {
    if (totalGross < totalNet) {
      issues.push(
        `Total gross (${totalGross.toFixed(3)} kg) < total net (${totalNet.toFixed(3)} kg)`,
      );
    } else {
      const totalRatio = totalGross / totalNet;
      if (totalRatio < MIN_TOTAL_RATIO || totalRatio > MAX_TOTAL_RATIO) {
        warnings.push(
          `Total gross/net ratio = ${totalRatio.toFixed(2)} (expected ${MIN_TOTAL_RATIO}-${MAX_TOTAL_RATIO})`,
        );
      }
    }
  }

  if (issues.length > 0) {
    return {
      checkName,
      status: 'failed',
      expectedValue: `Gross > Net, ratio ${MIN_ITEM_RATIO}-${MAX_ITEM_RATIO}`,
      actualValue: issues.join('; '),
      documentsCompared: 'INV / PL',
      message: issues.join('. ') + '.',
    };
  }

  if (warnings.length > 0) {
    return {
      checkName,
      status: 'warning',
      expectedValue: `Ratio ${MIN_ITEM_RATIO}-${MAX_ITEM_RATIO} per item, ${MIN_TOTAL_RATIO}-${MAX_TOTAL_RATIO} total`,
      actualValue: warnings.join('; '),
      documentsCompared: 'INV / PL',
      message: warnings.join('. ') + '.',
    };
  }

  const totalRatio = totalGross > 0 && totalNet > 0 ? (totalGross / totalNet).toFixed(2) : 'N/A';
  return {
    checkName,
    status: 'passed',
    expectedValue: `Ratio ${MIN_TOTAL_RATIO}-${MAX_TOTAL_RATIO}`,
    actualValue: `Total ratio: ${totalRatio}`,
    documentsCompared: 'INV / PL',
    message: 'Todas as proporcoes de peso estao dentro da faixa aceitavel.',
  };
}
