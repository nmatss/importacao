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

export default function paymentTermsCheck(input: CheckInput): CheckResult {
  const checkName = 'payment-terms-check';

  if (!input.invoiceData) {
    return {
      checkName,
      status: 'skipped',
      documentsCompared: 'INV',
      message: 'aguardando INV',
    };
  }

  const invPaymentTerms = input.invoiceData?.paymentTerms as Record<string, any> | undefined;

  if (!invPaymentTerms) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: 'INV',
      message: 'Nenhuma condicao de pagamento encontrada na invoice.',
    };
  }

  const issues: string[] = [];
  const incomplete: string[] = [];

  // `Number(x ?? 0)` transformava percentual NAO EXTRAIDO em 0: uma invoice com
  // depositPercent=30 e balancePercent ausente somava 30 e o check devolvia
  // `failed` "esperado 100%". Vazio virava zero e zero virava divergencia.
  const depositParsed = parseDocumentNumber(
    invPaymentTerms.depositPercent ?? invPaymentTerms.deposit,
  );
  const balanceParsed = parseDocumentNumber(
    invPaymentTerms.balancePercent ?? invPaymentTerms.balance,
  );
  const depositPercent = depositParsed.ok ? depositParsed.value : null;
  const balancePercent = balanceParsed.ok ? balanceParsed.value : null;

  if (depositPercent != null && balancePercent != null) {
    const total = depositPercent + balancePercent;
    if (Math.abs(total - 100) > 0.01) {
      issues.push(
        `Deposito (${depositPercent}%) + Saldo (${balancePercent}%) = ${total}%, esperado 100%`,
      );
    }
  } else if (depositPercent != null || balancePercent != null) {
    incomplete.push(
      `Condicao de pagamento incompleta: deposito=${depositPercent ?? 'nao extraido'}, saldo=${balancePercent ?? 'nao extraido'} — soma nao avaliada`,
    );
  }

  // Check paymentDays > 0
  const paymentDaysParsed = parseDocumentNumber(
    invPaymentTerms.paymentDays ?? invPaymentTerms.days,
  );
  const paymentDays = paymentDaysParsed.ok ? paymentDaysParsed.value : null;
  if (paymentDays != null && paymentDays <= 0) {
    issues.push(`Dias de pagamento e ${paymentDays}, esperado > 0`);
  } else if (
    paymentDays == null &&
    (invPaymentTerms.paymentDays != null || invPaymentTerms.days != null)
  ) {
    incomplete.push(
      `Dias de pagamento presentes mas nao interpretaveis: "${paymentDaysParsed.raw}"`,
    );
  }

  // Compare with process DB payment terms if available
  const dbPaymentTerms = input.processData?.paymentTerms as Record<string, any> | undefined;
  const termsWarnings: string[] = [];

  if (dbPaymentTerms) {
    const dbDepositParsed = parseDocumentNumber(
      dbPaymentTerms.depositPercent ?? dbPaymentTerms.deposit,
    );
    const dbBalanceParsed = parseDocumentNumber(
      dbPaymentTerms.balancePercent ?? dbPaymentTerms.balance,
    );
    const dbDaysParsed = parseDocumentNumber(dbPaymentTerms.paymentDays ?? dbPaymentTerms.days);
    const dbDeposit = dbDepositParsed.ok ? dbDepositParsed.value : null;
    const dbBalance = dbBalanceParsed.ok ? dbBalanceParsed.value : null;
    const dbDays = dbDaysParsed.ok ? dbDaysParsed.value : null;

    if (
      dbDeposit != null &&
      dbDeposit > 0 &&
      depositPercent != null &&
      depositPercent > 0 &&
      Math.abs(dbDeposit - depositPercent) > 0.01
    ) {
      termsWarnings.push(`Deposit: INV=${depositPercent}%, DB=${dbDeposit}%`);
    }
    if (
      dbBalance != null &&
      dbBalance > 0 &&
      balancePercent != null &&
      balancePercent > 0 &&
      Math.abs(dbBalance - balancePercent) > 0.01
    ) {
      termsWarnings.push(`Balance: INV=${balancePercent}%, DB=${dbBalance}%`);
    }
    if (
      dbDays != null &&
      dbDays > 0 &&
      paymentDays != null &&
      paymentDays > 0 &&
      dbDays !== paymentDays
    ) {
      termsWarnings.push(`Payment days: INV=${paymentDays}, DB=${dbDays}`);
    }
  }

  const summary = `Deposit=${depositPercent ?? 'nao extraido'}%, Balance=${balancePercent ?? 'nao extraido'}%, Days=${paymentDays ?? 'nao extraido'}`;

  if (issues.length > 0) {
    return {
      checkName,
      status: 'failed',
      expectedValue: 'Deposito + Saldo = 100%, dias > 0',
      actualValue: summary,
      documentsCompared: dbPaymentTerms ? 'INV vs Sistema' : 'INV',
      message: issues.join('. ') + '.',
    };
  }

  if (incomplete.length > 0) {
    return {
      checkName,
      status: 'warning',
      expectedValue: 'Deposito + Saldo = 100%, dias > 0',
      actualValue: summary,
      documentsCompared: dbPaymentTerms ? 'INV vs Sistema' : 'INV',
      message: incomplete.join('. ') + '.',
    };
  }

  if (termsWarnings.length > 0) {
    return {
      checkName,
      status: 'warning',
      expectedValue: 'Condicoes conforme registros do sistema',
      actualValue: termsWarnings.join('; '),
      documentsCompared: 'INV vs Sistema',
      message: `Condicoes de pagamento divergem do sistema: ${termsWarnings.join('; ')}.`,
    };
  }

  return {
    checkName,
    status: 'passed',
    expectedValue: '100%',
    actualValue: summary,
    documentsCompared: dbPaymentTerms ? 'INV vs Sistema' : 'INV',
    message: 'Condicoes de pagamento validas.',
  };
}
