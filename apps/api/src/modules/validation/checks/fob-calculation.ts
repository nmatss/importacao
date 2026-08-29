import { parseDocumentNumber } from '../utils/number-normalize.js';

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
  const totalFobParsed = parseDocumentNumber(
    input.invoiceData?.totalFobValue ?? input.invoiceData?.totalValue,
  );
  const totalFob = totalFobParsed.ok ? totalFobParsed.value : null;

  if (!items || items.length === 0) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: 'INV',
      message: 'Nenhum item encontrado na Invoice para verificar o calculo FOB.',
    };
  }

  if (!totalFob) {
    // Distingue os tres casos em vez de chamar tudo de "nao encontrado".
    let message = 'Valor FOB total nao encontrado na Invoice.';
    if (totalFob === 0) {
      message = 'Valor FOB total declarado na Invoice e 0.00 — verifique o documento original.';
    } else if (!totalFobParsed.ok && totalFobParsed.reason !== 'absent') {
      message = `Valor FOB total da Invoice presente mas nao interpretavel: "${totalFobParsed.raw}".`;
    }
    return {
      checkName,
      status: 'warning',
      documentsCompared: 'INV',
      message,
    };
  }

  let focCount = 0;
  let focQuantity = 0;
  let adjustmentCount = 0;
  let adjustmentTotal = 0;
  let grossItemTotal = 0;
  const unpricedItems: string[] = [];

  const calculatedTotal = items.reduce((sum, item) => {
    const classification = classifyItem(item);
    const rawLineAmount = getRawLineAmount(item);
    const declaredLineAmount = getDeclaredLineAmount(item);

    if (classification === 'unpriced') {
      unpricedItems.push(
        String(
          item.itemCode ?? item.code ?? item.description ?? `linha ${unpricedItems.length + 1}`,
        ),
      );
      grossItemTotal += declaredLineAmount;
      return sum + declaredLineAmount;
    }

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

  // Item com preco 0 (ou ilegivel) e SEM marcador de FOC nao e brinde: e preco
  // provavelmente nao extraido. Reportar, nunca excluir em silencio do FOB.
  if (unpricedItems.length > 0) {
    return {
      checkName,
      status: 'warning',
      expectedValue: totalFob.toFixed(2),
      actualValue: calculatedTotal.toFixed(2),
      documentsCompared: 'INV',
      message: `${unpricedItems.length} item(ns) sem preco extraido e sem marcador de FOC (${unpricedItems.join(', ')}): calculo FOB nao conclusivo — soma dos itens = ${calculatedTotal.toFixed(2)}, total declarado = ${totalFob.toFixed(2)} (diferenca: ${difference.toFixed(2)})${focNote}${adjustmentNote}.`,
    };
  }

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

type ItemClassification = 'commercial' | 'free_of_charge' | 'adjustment' | 'unpriced';

const PRICE_KEYS = ['unitPrice', 'unit_price', 'precoUnitario'];
const TOTAL_KEYS = ['totalPrice', 'amount', 'total', 'amountUsd', 'valorTotal'];
const QUANTITY_KEYS = ['quantity', 'qty', 'quantidade'];

const FREE_OF_CHARGE_RE =
  /\b(foc|free\s*of\s*charge|complimentary|sample|amostra|brinde|bonificacao|bonificado)\b/i;
const DISCOUNT_RE = /\b(discount|desconto)\b/i;

function classifyItem(item: Record<string, any>): ItemClassification {
  const unitPrice = getItemNumber(item, PRICE_KEYS);
  const totalPrice = getItemNumber(item, TOTAL_KEYS);
  const quantity = getItemNumber(item, QUANTITY_KEYS);
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
  // FOC exige marcador EXPLICITO (campo booleano ou texto). Preco zero sozinho
  // nao classifica mais o item como brinde: se a extracao falhou e devolveu 0
  // em vez de ausente, o item comercial sumia do somatorio e o FOB "conferia".
  if (explicitFree || hasFreeMarker) {
    return 'free_of_charge';
  }
  if (hasDiscountMarker && (totalPrice === 0 || unitPrice === 0)) {
    return 'free_of_charge';
  }
  if (hasZeroPrice || hasUnreadableNumber(item, [...PRICE_KEYS, ...TOTAL_KEYS])) {
    return 'unpriced';
  }
  // Linha sem NENHUM campo de preco cai no mesmo caso: hoje ela entrava no
  // somatorio valendo 0 (unitPrice 0 x quantity 0) sem deixar rastro.
  if (totalPrice == null && unitPrice == null) {
    return 'unpriced';
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

/**
 * Delegado ao normalizador unico do modulo (`utils/number-normalize.ts`), que
 * trata milhar/decimal brasileiro, parenteses negativos e — diferente da
 * versao local anterior — recusa o caso ambiguo "1.234" em vez de le-lo como
 * 1,234.
 */
function toNumberOrNull(value: unknown): number | null {
  const parsed = parseDocumentNumber(value);
  return parsed.ok ? parsed.value : null;
}

/** `true` quando o campo veio preenchido mas nao pode ser lido como numero. */
function hasUnreadableNumber(item: Record<string, any>, keys: string[]): boolean {
  return keys.some((key) => {
    if (item[key] == null) return false;
    const parsed = parseDocumentNumber(item[key]);
    return !parsed.ok && parsed.reason !== 'absent';
  });
}
