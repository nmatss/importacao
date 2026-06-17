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

export default function fobCalculation(input: CheckInput): CheckResult {
  const checkName = 'fob-calculation';

  if (!input.invoiceData) {
    return {
      checkName,
      status: 'skipped',
      documentsCompared: 'INV',
      message: 'aguardando INV',
    };
  }

  const items = input.invoiceData?.items as Array<Record<string, any>> | undefined;
  const totalFob = toNumberOrNull(
    input.invoiceData?.totalFobValue ?? input.invoiceData?.totalValue,
  );

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

  let focCount = 0;
  let focQuantity = 0;
  let adjustmentCount = 0;
  let adjustmentTotal = 0;
  let grossItemTotal = 0;

  const calculatedTotal = items.reduce((sum, item) => {
    const classification = classifyItem(item);
    const rawLineAmount = getRawLineAmount(item);
    const declaredLineAmount = getDeclaredLineAmount(item);

    if (classification === 'free_of_charge') {
      focCount++;
      focQuantity += toNumberOrNull(item.quantity) ?? 0;
      grossItemTotal += rawLineAmount;
      return sum;
    }

    if (classification === 'adjustment') {
      adjustmentCount++;
      adjustmentTotal += declaredLineAmount;
      return sum + declaredLineAmount;
    }

    grossItemTotal += declaredLineAmount;
    return sum + declaredLineAmount;
  }, 0);

  const difference = Math.abs(calculatedTotal - totalFob);
  const focNote =
    focCount > 0 ? ` (${focCount} item(s) FOC, qty ${focQuantity} - nao somados)` : '';
  const adjustmentNote =
    adjustmentCount > 0
      ? ` (${adjustmentCount} ajuste(s)/desconto(s), total ${adjustmentTotal.toFixed(2)})`
      : '';

  // Use proportional tolerance: max(1.00, 0.1% of total) to handle floating-point accumulation
  const tolerance = Math.max(1.0, totalFob * 0.001);
  if (difference <= tolerance) {
    const rawDifference = Math.abs(grossItemTotal - totalFob);
    if (
      (focCount > 0 || adjustmentCount > 0) &&
      (rawDifference > tolerance || adjustmentCount > 0)
    ) {
      return {
        checkName,
        status: 'warning',
        expectedValue: totalFob.toFixed(2),
        actualValue: grossItemTotal.toFixed(2),
        documentsCompared: 'INV',
        message: `Diferença explicada por item FOC/desconto identificado na Invoice: soma dos itens = ${grossItemTotal.toFixed(2)}, total declarado = ${totalFob.toFixed(2)} (diferenca: ${rawDifference.toFixed(2)}). Total ajustado = ${calculatedTotal.toFixed(2)}${focNote}${adjustmentNote}.`,
      };
    }
    return {
      checkName,
      status: 'passed',
      expectedValue: totalFob.toFixed(2),
      actualValue: calculatedTotal.toFixed(2),
      documentsCompared: 'INV',
      message: `Calculo FOB confere com o valor total${focNote}${adjustmentNote}.`,
    };
  }

  return {
    checkName,
    status: 'failed',
    expectedValue: totalFob.toFixed(2),
    actualValue: calculatedTotal.toFixed(2),
    documentsCompared: 'INV',
    message: `Divergencia no calculo FOB: soma dos itens = ${calculatedTotal.toFixed(2)}, total declarado = ${totalFob.toFixed(2)} (diferenca: ${difference.toFixed(2)})${focNote}${adjustmentNote}.`,
  };
}

type ItemClassification = 'commercial' | 'free_of_charge' | 'adjustment';

const FREE_OF_CHARGE_RE =
  /\b(foc|free\s*of\s*charge|complimentary|sample|amostra|brinde|bonificacao|bonificado)\b/i;
const DISCOUNT_RE = /\b(discount|desconto)\b/i;

function classifyItem(item: Record<string, any>): ItemClassification {
  const unitPrice = getItemNumber(item, ['unitPrice', 'unit_price', 'precoUnitario']);
  const totalPrice = getItemNumber(item, [
    'totalPrice',
    'amount',
    'total',
    'amountUsd',
    'valorTotal',
  ]);
  const quantity = getItemNumber(item, ['quantity', 'qty', 'quantidade']);
  const text = getItemText(item);
  const explicitFree = isTruthy(item.isFreeOfCharge) || isTruthy(item.isFoc) || isTruthy(item.foc);
  const hasFreeMarker = FREE_OF_CHARGE_RE.test(text);
  const hasDiscountMarker = DISCOUNT_RE.test(text);
  const hasNegativeValue =
    (totalPrice != null && totalPrice < 0) || (unitPrice != null && unitPrice < 0);
  const hasZeroPrice =
    (quantity ?? 0) > 0 &&
    ((totalPrice != null && totalPrice === 0) || (unitPrice != null && unitPrice === 0));

  if (hasNegativeValue || (hasDiscountMarker && totalPrice != null && totalPrice < 0)) {
    return 'adjustment';
  }
  if (explicitFree || hasFreeMarker || hasZeroPrice) {
    return 'free_of_charge';
  }
  if (hasDiscountMarker && (totalPrice === 0 || unitPrice === 0)) {
    return 'free_of_charge';
  }
  return 'commercial';
}

function getDeclaredLineAmount(item: Record<string, any>): number {
  const totalPrice = getItemNumber(item, [
    'totalPrice',
    'amount',
    'total',
    'amountUsd',
    'valorTotal',
  ]);
  if (totalPrice != null) return totalPrice;
  const unitPrice = getItemNumber(item, ['unitPrice', 'unit_price', 'precoUnitario']) ?? 0;
  const quantity = getItemNumber(item, ['quantity', 'qty', 'quantidade']) ?? 0;
  return unitPrice * quantity;
}

function getRawLineAmount(item: Record<string, any>): number {
  const unitPrice = getItemNumber(item, ['unitPrice', 'unit_price', 'precoUnitario']);
  const quantity = getItemNumber(item, ['quantity', 'qty', 'quantidade']);
  if (unitPrice != null && quantity != null) return unitPrice * quantity;
  return Math.abs(getDeclaredLineAmount(item));
}

function getItemNumber(item: Record<string, any>, keys: string[]): number | null {
  for (const key of keys) {
    const parsed = toNumberOrNull(item[key]);
    if (parsed != null) return parsed;
  }
  return null;
}

function getItemText(item: Record<string, any>): string {
  return [
    item.description,
    item.descricao,
    item.notes,
    item.observations,
    item.observacao,
    item.itemDescription,
    item.productDescription,
  ]
    .filter((value) => value != null)
    .map(String)
    .join(' ');
}

function isTruthy(value: unknown): boolean {
  return value === true || String(value).trim().toLowerCase() === 'true';
}

function toNumberOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  let clean = String(value).trim();
  const isParenthesesNegative = /^\(.*\)$/.test(clean);
  clean = clean.replace(/[^\d,.-]/g, '');
  if (!clean || clean === '-' || clean === '.' || clean === ',') return null;

  const lastComma = clean.lastIndexOf(',');
  const lastDot = clean.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    const decimal = lastComma > lastDot ? ',' : '.';
    const thousands = decimal === ',' ? '.' : ',';
    clean = clean.replace(new RegExp(`\\${thousands}`, 'g'), '');
    if (decimal === ',') clean = clean.replace(',', '.');
  } else if (lastComma > -1) {
    clean = clean.replace(',', '.');
  }

  const parsed = Number(clean);
  if (!Number.isFinite(parsed)) return null;
  return isParenthesesNegative ? -Math.abs(parsed) : parsed;
}
