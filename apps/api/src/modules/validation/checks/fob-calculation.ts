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
      message: 'No line items found in invoice to verify FOB calculation.',
    };
  }

  if (!totalFob) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: 'INV',
      message: 'Total FOB value not found in invoice.',
    };
  }

  const calculatedTotal = items.reduce((sum, item) => {
    const unitPrice = Number(item.unitPrice ?? 0);
    const quantity = Number(item.quantity ?? 0);
    return sum + unitPrice * quantity;
  }, 0);

  const difference = Math.abs(calculatedTotal - totalFob);

  // Use proportional tolerance: max(1.00, 0.1% of total) to handle floating-point accumulation
  const tolerance = Math.max(1.0, totalFob * 0.001);
  if (difference <= tolerance) {
    return {
      checkName,
      status: 'passed',
      expectedValue: totalFob.toFixed(2),
      actualValue: calculatedTotal.toFixed(2),
      documentsCompared: 'INV',
      message: 'FOB calculation matches total value.',
    };
  }

  return {
    checkName,
    status: 'failed',
    expectedValue: totalFob.toFixed(2),
    actualValue: calculatedTotal.toFixed(2),
    documentsCompared: 'INV',
    message: `FOB calculation mismatch: sum of items = ${calculatedTotal.toFixed(2)}, declared total = ${totalFob.toFixed(2)} (difference: ${difference.toFixed(2)}).`,
  };
}
