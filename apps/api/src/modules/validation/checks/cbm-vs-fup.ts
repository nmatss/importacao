import {
  describeNumericFailure,
  parseDocumentNumber,
  parseSystemNumber,
  type ParsedNumericFail,
} from '../utils/number-normalize.js';
import {
  ASSUMED_VOLUME_UNIT,
  describeUnitDivergence,
  normalizeVolumeUnit,
} from '../utils/measure-normalize.js';

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

  const blParsed = parseDocumentNumber(input.blData?.totalCbm ?? input.blData?.cbm);
  const processParsed = parseSystemNumber(input.processData?.totalCbm);

  if (!processParsed.ok) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: 'BL vs Sistema',
      message:
        processParsed.reason === 'absent'
          ? 'Ignorado: CBM nao cadastrado no processo.'
          : `${describeNumericFailure('CBM do sistema', processParsed as ParsedNumericFail)}.`,
    };
  }

  if (!blParsed.ok) {
    return {
      checkName,
      status: 'warning',
      expectedValue: processParsed.value.toFixed(3),
      documentsCompared: 'BL vs Sistema',
      message:
        blParsed.reason === 'absent'
          ? 'CBM nao encontrado no BL.'
          : `${describeNumericFailure('CBM do BL', blParsed as ParsedNumericFail)}.`,
    };
  }

  const unitIssue = describeUnitDivergence(
    [{ label: 'BL', unit: blParsed.unit }],
    normalizeVolumeUnit,
    ASSUMED_VOLUME_UNIT,
  );
  if (unitIssue) {
    return {
      checkName,
      status: 'warning',
      expectedValue: processParsed.value.toFixed(3),
      actualValue: blParsed.raw,
      documentsCompared: 'BL vs Sistema',
      message: `Nao foi possivel confirmar a unidade do CBM antes de comparar (${unitIssue}).`,
    };
  }

  const blCbm = blParsed.value;
  const processCbm = processParsed.value;
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
