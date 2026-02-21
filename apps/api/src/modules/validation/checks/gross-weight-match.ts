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

const TOLERANCE = 0.5;

export default function grossWeightMatch(input: CheckInput): CheckResult {
  const checkName = 'gross-weight-match';

  const invGross = input.invoiceData?.totalGrossWeight != null ? Number(input.invoiceData.totalGrossWeight) : null;
  const plGross = input.packingListData?.totalGrossWeight != null ? Number(input.packingListData.totalGrossWeight) : null;
  const blGross = input.blData?.totalGrossWeight != null ? Number(input.blData.totalGrossWeight) : null;

  const sources: string[] = [];
  const values: number[] = [];

  if (invGross != null && !isNaN(invGross)) { sources.push('INV'); values.push(invGross); }
  if (plGross != null && !isNaN(plGross)) { sources.push('PL'); values.push(plGross); }
  if (blGross != null && !isNaN(blGross)) { sources.push('BL'); values.push(blGross); }

  if (values.length < 2) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: sources.join(' vs '),
      message: 'Not enough documents to compare gross weight.',
    };
  }

  // Check gross > net
  const invNet = input.invoiceData?.totalNetWeight != null ? Number(input.invoiceData.totalNetWeight) : null;
  const plNet = input.packingListData?.totalNetWeight != null ? Number(input.packingListData.totalNetWeight) : null;

  const netWeight = invNet ?? plNet;
  const grossWeight = values[0];

  if (netWeight != null && grossWeight <= netWeight) {
    return {
      checkName,
      status: 'failed',
      expectedValue: `Gross > Net (net: ${netWeight.toFixed(3)} kg)`,
      actualValue: `Gross: ${grossWeight.toFixed(3)} kg`,
      documentsCompared: sources.join(' vs '),
      message: `Gross weight (${grossWeight.toFixed(3)} kg) is not greater than net weight (${netWeight.toFixed(3)} kg).`,
    };
  }

  // Check consistency across documents
  const maxDiff = Math.max(
    ...values.map((v) => Math.abs(v - values[0])),
  );

  if (maxDiff <= TOLERANCE) {
    return {
      checkName,
      status: 'passed',
      expectedValue: values[0].toFixed(3),
      actualValue: values.map((v, i) => `${sources[i]}=${v.toFixed(3)}`).join(', '),
      documentsCompared: sources.join(' vs '),
      message: `Gross weight matches across documents within tolerance (max diff: ${maxDiff.toFixed(3)} kg).`,
    };
  }

  const details = sources.map((s, i) => `${s}=${values[i].toFixed(3)}`).join(', ');
  return {
    checkName,
    status: 'failed',
    expectedValue: values[0].toFixed(3),
    actualValue: details,
    documentsCompared: sources.join(' vs '),
    message: `Gross weight mismatch: ${details} (max diff: ${maxDiff.toFixed(3)} kg, tolerance: ${TOLERANCE} kg).`,
  };
}
