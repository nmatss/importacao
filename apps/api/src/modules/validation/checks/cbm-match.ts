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

const TOLERANCE = 0.1;

export default function cbmMatch(input: CheckInput): CheckResult {
  const checkName = 'cbm-match';

  const invCbm = input.invoiceData?.totalCbm != null ? Number(input.invoiceData.totalCbm) : null;
  const plCbm =
    input.packingListData?.totalCbm != null ? Number(input.packingListData.totalCbm) : null;
  const blRaw = input.blData?.totalCbm ?? input.blData?.totalVolume;
  const blCbm = blRaw != null ? Number(blRaw) : null;

  const sources: string[] = [];
  const values: number[] = [];

  if (invCbm != null && !isNaN(invCbm)) {
    sources.push('INV');
    values.push(invCbm);
  }
  if (plCbm != null && !isNaN(plCbm)) {
    sources.push('PL');
    values.push(plCbm);
  }
  if (blCbm != null && !isNaN(blCbm)) {
    sources.push('BL');
    values.push(blCbm);
  }

  if (values.length < 2) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: sources.join(' vs '),
      message: 'Documentos insuficientes para comparar CBM.',
    };
  }

  const maxDiff = Math.max(...values.map((v) => Math.abs(v - values[0])));

  if (maxDiff <= TOLERANCE) {
    return {
      checkName,
      status: 'passed',
      expectedValue: values[0].toFixed(3),
      actualValue: values.map((v, i) => `${sources[i]}=${v.toFixed(3)}`).join(', '),
      documentsCompared: sources.join(' vs '),
      message: `CBM confere entre os documentos dentro da tolerancia (diff max: ${maxDiff.toFixed(3)}).`,
    };
  }

  const details = sources.map((s, i) => `${s}=${values[i].toFixed(3)}`).join(', ');
  return {
    checkName,
    status: 'failed',
    expectedValue: values[0].toFixed(3),
    actualValue: details,
    documentsCompared: sources.join(' vs '),
    message: `Divergencia no CBM: ${details} (diff max: ${maxDiff.toFixed(3)}, tolerancia: ${TOLERANCE}).`,
  };
}
