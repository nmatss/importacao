import {
  describeNumericFailure,
  parseDocumentNumber,
  parseSystemNumber,
  type ParsedNumericFail,
} from '../utils/number-normalize.js';
import { compareCurrencies } from '../utils/currency-normalize.js';

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

const documentsCompared = 'BL vs Follow-up';

export default function freightValueMatch(input: CheckInput): CheckResult {
  const checkName = 'freight-value-match';

  const blFreight = parseDocumentNumber(input.blData?.freightValue);
  const followUpFreight = parseSystemNumber(input.followUpData?.freightValue);

  if (!followUpFreight.ok) {
    return {
      checkName,
      status: 'warning',
      documentsCompared,
      message:
        followUpFreight.reason === 'absent'
          ? 'Ignorado: Nenhum valor de frete disponivel nos dados do follow-up.'
          : `${describeNumericFailure('Frete do follow-up', followUpFreight as ParsedNumericFail)}.`,
    };
  }

  if (!blFreight.ok) {
    return {
      checkName,
      status: 'warning',
      expectedValue: followUpFreight.value.toFixed(2),
      documentsCompared,
      message:
        blFreight.reason === 'absent'
          ? 'Valor do frete nao encontrado no BL.'
          : `${describeNumericFailure('Frete do BL', blFreight as ParsedNumericFail)}.`,
    };
  }

  const currency = compareCurrencies(
    'BL',
    input.blData?.freightCurrency,
    'Follow-up',
    input.followUpData?.freightCurrency,
  );

  if (currency.state === 'different') {
    return {
      checkName,
      status: 'warning',
      expectedValue: `${followUpFreight.value.toFixed(2)} ${currency.rightCode}`,
      actualValue: `${blFreight.value.toFixed(2)} ${currency.leftCode}`,
      documentsCompared,
      message: `Moedas diferentes (${currency.left} vs ${currency.right}): comparacao do frete nao realizada.`,
    };
  }

  const difference = Math.abs(blFreight.value - followUpFreight.value);
  const currencyNote = currency.state === 'unknown' ? ` (${currency.detail})` : '';

  if (difference <= 0.01) {
    return {
      checkName,
      status: 'passed',
      expectedValue: followUpFreight.value.toFixed(2),
      actualValue: blFreight.value.toFixed(2),
      documentsCompared,
      message: `Valor do frete confere entre o BL e os dados do follow-up${currencyNote}.`,
    };
  }

  // Sem moeda confirmada nas duas pontas, divergencia numerica e indicio:
  // `failed` aqui gera rascunho de e-mail de correcao para fora da empresa.
  return {
    checkName,
    status: currency.state === 'equal' ? 'failed' : 'warning',
    expectedValue: followUpFreight.value.toFixed(2),
    actualValue: blFreight.value.toFixed(2),
    documentsCompared,
    message: `Divergencia no valor do frete: BL=${blFreight.value.toFixed(2)} vs Follow-up=${followUpFreight.value.toFixed(2)} (dif: ${difference.toFixed(2)})${currencyNote}.`,
  };
}
