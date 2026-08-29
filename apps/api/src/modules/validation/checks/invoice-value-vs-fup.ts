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

const documentsCompared = 'Invoice vs Sistema';

export default function invoiceValueVsFup(input: CheckInput): CheckResult {
  const checkName = 'invoice-value-vs-fup';

  const invoiceFob = parseDocumentNumber(input.invoiceData?.totalFobValue);
  const processFob = parseSystemNumber(input.processData?.totalFobValue);

  if (!processFob.ok) {
    return {
      checkName,
      status: 'warning',
      documentsCompared,
      message:
        processFob.reason === 'absent'
          ? 'Ignorado: Valor FOB nao cadastrado no processo.'
          : `${describeNumericFailure('Valor FOB do sistema', processFob as ParsedNumericFail)}.`,
    };
  }

  if (!invoiceFob.ok) {
    return {
      checkName,
      status: 'warning',
      expectedValue: processFob.value.toFixed(2),
      documentsCompared,
      message:
        invoiceFob.reason === 'absent'
          ? 'Valor FOB total nao encontrado na Invoice.'
          : `${describeNumericFailure('Valor FOB da Invoice', invoiceFob as ParsedNumericFail)}.`,
    };
  }

  // `import_processes` nao tem coluna de moeda: o valor do sistema esta em USD
  // por convencao. Comparar numero contra numero sem checar a moeda da invoice
  // produzia um `failed` de valor toda vez que a invoice vinha em outra moeda.
  const currency = compareCurrencies(
    'Invoice',
    input.invoiceData?.currency,
    'Sistema',
    SYSTEM_REFERENCE_CURRENCY,
  );

  if (currency.state === 'different') {
    return {
      checkName,
      status: 'warning',
      expectedValue: `${processFob.value.toFixed(2)} ${SYSTEM_REFERENCE_CURRENCY}`,
      actualValue: `${invoiceFob.value.toFixed(2)} ${currency.leftCode}`,
      documentsCompared,
      message: `Moedas diferentes (${currency.left} vs ${currency.right}): comparacao de valor FOB nao realizada. Converta a moeda ou corrija o cadastro antes de comparar.`,
    };
  }

  const difference = Math.abs(invoiceFob.value - processFob.value);
  const currencyNote = currency.state === 'unknown' ? ` (${currency.detail})` : '';

  if (difference <= 0.01) {
    return {
      checkName,
      status: 'passed',
      expectedValue: processFob.value.toFixed(2),
      actualValue: invoiceFob.value.toFixed(2),
      documentsCompared,
      message: `Valor FOB da Invoice confere com o sistema${currencyNote}.`,
    };
  }

  // Sem moeda confirmada nas duas pontas a divergencia e indicio, nao veredito:
  // `failed` aqui abre fluxo de correcao com fornecedor externo.
  return {
    checkName,
    status: currency.state === 'equal' ? 'failed' : 'warning',
    expectedValue: processFob.value.toFixed(2),
    actualValue: invoiceFob.value.toFixed(2),
    documentsCompared,
    message: `Divergencia no valor FOB: Invoice=${invoiceFob.value.toFixed(2)} vs Sistema=${processFob.value.toFixed(2)} (diff: ${difference.toFixed(2)})${currencyNote}.`,
  };
}
