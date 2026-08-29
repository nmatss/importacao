import {
  describeNumericFailure,
  parseDocumentNumber,
  parseSystemNumber,
  type ParsedNumericFail,
} from '../utils/number-normalize.js';
import { SYSTEM_REFERENCE_CURRENCY, compareCurrencies } from '../utils/currency-normalize.js';

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

const documentsCompared = 'BL vs Sistema';

export default function freightVsFup(input: CheckInput): CheckResult {
  const checkName = 'freight-vs-fup';

  const blFreight = parseDocumentNumber(input.blData?.freightValue);
  const processFreight = parseSystemNumber(input.processData?.freightValue);

  if (!processFreight.ok) {
    return {
      checkName,
      status: 'warning',
      documentsCompared,
      message:
        processFreight.reason === 'absent'
          ? 'Ignorado: Valor do frete nao cadastrado no processo.'
          : `${describeNumericFailure('Frete do sistema', processFreight as ParsedNumericFail)}.`,
    };
  }

  if (!blFreight.ok) {
    return {
      checkName,
      status: 'warning',
      expectedValue: processFreight.value.toFixed(2),
      documentsCompared,
      message:
        blFreight.reason === 'absent'
          ? 'Valor do frete nao encontrado no BL.'
          : `${describeNumericFailure('Frete do BL', blFreight as ParsedNumericFail)}.`,
    };
  }

  // `blData.freightCurrency` tambem carrega "PREPAID"/"COLLECT" quando o frete
  // nao esta valorado — nesse caso a moeda fica indefinida e a comparacao vira
  // indicio, nunca veredito.
  const currency = compareCurrencies(
    'BL',
    input.blData?.freightCurrency,
    'Sistema',
    SYSTEM_REFERENCE_CURRENCY,
  );

  if (currency.state === 'different') {
    return {
      checkName,
      status: 'warning',
      expectedValue: `${processFreight.value.toFixed(2)} ${SYSTEM_REFERENCE_CURRENCY}`,
      actualValue: `${blFreight.value.toFixed(2)} ${currency.leftCode}`,
      documentsCompared,
      message: `Moedas diferentes (${currency.left} vs ${currency.right}): comparacao do frete nao realizada.`,
    };
  }

  const difference = Math.abs(blFreight.value - processFreight.value);
  const currencyNote = currency.state === 'unknown' ? ` (${currency.detail})` : '';

  if (difference <= 0.01) {
    return {
      checkName,
      status: 'passed',
      expectedValue: processFreight.value.toFixed(2),
      actualValue: blFreight.value.toFixed(2),
      documentsCompared,
      message: `Valor do frete no BL confere com o sistema${currencyNote}.`,
    };
  }

  return {
    checkName,
    status: currency.state === 'equal' ? 'failed' : 'warning',
    expectedValue: processFreight.value.toFixed(2),
    actualValue: blFreight.value.toFixed(2),
    documentsCompared,
    message: `Divergencia no frete: BL=${blFreight.value.toFixed(2)} vs Sistema=${processFreight.value.toFixed(2)} (diff: ${difference.toFixed(2)})${currencyNote}.`,
  };
}
