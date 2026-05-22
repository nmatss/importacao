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

export default function fobCalculation(input: CheckInput): CheckResult {
  const checkName = 'fob-calculation';
  const items = input.invoiceData?.items as Array<Record<string, any>> | undefined;
  const totalFob = Number(input.invoiceData?.totalFobValue ?? input.invoiceData?.totalValue ?? 0);

  if (!items || items.length === 0) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: 'INV',
      message: 'Nenhum item encontrado na Invoice para verificar o calculo FOB.',
    };
  }

  if (!totalFob) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: 'INV',
      message: 'Valor FOB total nao encontrado na Invoice.',
    };
  }

  const FOC_DESCRIPTION_RE = /\b(foc|free\s*of\s*charge|complimentary|sample|amostra|brinde)\b/i;

  const isFreeOfCharge = (item: Record<string, any>): boolean => {
    if (item.isFreeOfCharge === true) return true;
    const unitPrice = Number(item.unitPrice ?? 0);
    if (unitPrice === 0 && Number(item.quantity ?? 0) > 0) return true;
    const desc = String(item.description ?? '');
    if (FOC_DESCRIPTION_RE.test(desc)) return true;
    return false;
  };

  let focCount = 0;
  let focQuantity = 0;
  const calculatedTotal = items.reduce((sum, item) => {
    if (isFreeOfCharge(item)) {
      focCount++;
      focQuantity += Number(item.quantity ?? 0);
      return sum;
    }
    const unitPrice = Number(item.unitPrice ?? 0);
    const quantity = Number(item.quantity ?? 0);
    return sum + unitPrice * quantity;
  }, 0);

  const difference = Math.abs(calculatedTotal - totalFob);
  const focNote =
    focCount > 0 ? ` (${focCount} item(s) FOC, qty ${focQuantity} — nao somados)` : '';

  // Use proportional tolerance: max(1.00, 0.1% of total) to handle floating-point accumulation
  const tolerance = Math.max(1.0, totalFob * 0.001);
  if (difference <= tolerance) {
    return {
      checkName,
      status: 'passed',
      expectedValue: totalFob.toFixed(2),
      actualValue: calculatedTotal.toFixed(2),
      documentsCompared: 'INV',
      message: `Calculo FOB confere com o valor total${focNote}.`,
    };
  }

  return {
    checkName,
    status: 'failed',
    expectedValue: totalFob.toFixed(2),
    actualValue: calculatedTotal.toFixed(2),
    documentsCompared: 'INV',
    message: `Divergencia no calculo FOB: soma dos itens = ${calculatedTotal.toFixed(2)}, total declarado = ${totalFob.toFixed(2)} (diferenca: ${difference.toFixed(2)})${focNote}.`,
  };
}
