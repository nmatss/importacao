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

export default function cbmVsFup(input: CheckInput): CheckResult {
  const checkName = 'cbm-vs-fup';

  const blCbmRaw = input.blData?.cbm != null ? Number(input.blData.cbm) : null;
  const processCbmRaw = input.processData?.totalCbm != null ? Number(input.processData.totalCbm) : null;
  const blCbm = blCbmRaw != null && !isNaN(blCbmRaw) ? blCbmRaw : null;
  const processCbm = processCbmRaw != null && !isNaN(processCbmRaw) ? processCbmRaw : null;

  if (processCbm == null) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: 'BL vs Sistema',
      message: 'Skipped: CBM nao cadastrado no processo.',
    };
  }

  if (blCbm == null) {
    return {
      checkName,
      status: 'warning',
      expectedValue: processCbm.toFixed(3),
      documentsCompared: 'BL vs Sistema',
      message: 'CBM nao encontrado no BL.',
    };
  }

  const difference = Math.abs(blCbm - processCbm);
  const tolerance = Math.max(processCbm * 0.02, 0.01); // 2% tolerance for CBM, minimum 0.01

  if (difference <= tolerance) {
    return {
      checkName,
      status: 'passed',
      expectedValue: processCbm.toFixed(3),
      actualValue: blCbm.toFixed(3),
      documentsCompared: 'BL vs Sistema',
      message: 'CBM no BL confere com o sistema.',
    };
  }

  return {
    checkName,
    status: 'failed',
    expectedValue: processCbm.toFixed(3),
    actualValue: blCbm.toFixed(3),
    documentsCompared: 'BL vs Sistema',
    message: `Divergencia no CBM: BL=${blCbm.toFixed(3)} vs Sistema=${processCbm.toFixed(3)} (diff: ${difference.toFixed(3)}).`,
  };
}
