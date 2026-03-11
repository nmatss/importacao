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

export default function paymentTermsCheck(input: CheckInput): CheckResult {
  const checkName = 'payment-terms-check';

  const invPaymentTerms = input.invoiceData?.paymentTerms as Record<string, any> | undefined;

  if (!invPaymentTerms) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: 'INV',
      message: 'No payment terms found in invoice.',
    };
  }

  const issues: string[] = [];

  // Check deposit% + balance% = 100%
  const depositPercent = Number(invPaymentTerms.depositPercent ?? invPaymentTerms.deposit ?? 0);
  const balancePercent = Number(invPaymentTerms.balancePercent ?? invPaymentTerms.balance ?? 0);

  if (depositPercent > 0 || balancePercent > 0) {
    const total = depositPercent + balancePercent;
    if (Math.abs(total - 100) > 0.01) {
      issues.push(`Deposit (${depositPercent}%) + Balance (${balancePercent}%) = ${total}%, expected 100%`);
    }
  }

  // Check paymentDays > 0
  const paymentDays = Number(invPaymentTerms.paymentDays ?? invPaymentTerms.days ?? 0);
  if (paymentDays <= 0 && (invPaymentTerms.paymentDays != null || invPaymentTerms.days != null)) {
    issues.push(`Payment days is ${paymentDays}, expected > 0`);
  }

  // Compare with process DB payment terms if available
  const dbPaymentTerms = input.processData?.paymentTerms as Record<string, any> | undefined;
  const termsWarnings: string[] = [];

  if (dbPaymentTerms) {
    const dbDeposit = Number(dbPaymentTerms.depositPercent ?? dbPaymentTerms.deposit ?? 0);
    const dbBalance = Number(dbPaymentTerms.balancePercent ?? dbPaymentTerms.balance ?? 0);
    const dbDays = Number(dbPaymentTerms.paymentDays ?? dbPaymentTerms.days ?? 0);

    if (dbDeposit > 0 && depositPercent > 0 && Math.abs(dbDeposit - depositPercent) > 0.01) {
      termsWarnings.push(`Deposit: INV=${depositPercent}%, DB=${dbDeposit}%`);
    }
    if (dbBalance > 0 && balancePercent > 0 && Math.abs(dbBalance - balancePercent) > 0.01) {
      termsWarnings.push(`Balance: INV=${balancePercent}%, DB=${dbBalance}%`);
    }
    if (dbDays > 0 && paymentDays > 0 && dbDays !== paymentDays) {
      termsWarnings.push(`Payment days: INV=${paymentDays}, DB=${dbDays}`);
    }
  }

  if (issues.length > 0) {
    return {
      checkName,
      status: 'failed',
      expectedValue: 'Deposit + Balance = 100%, days > 0',
      actualValue: `Deposit=${depositPercent}%, Balance=${balancePercent}%, Days=${paymentDays}`,
      documentsCompared: dbPaymentTerms ? 'INV vs Sistema' : 'INV',
      message: issues.join('. ') + '.',
    };
  }

  if (termsWarnings.length > 0) {
    return {
      checkName,
      status: 'warning',
      expectedValue: 'Terms matching DB records',
      actualValue: termsWarnings.join('; '),
      documentsCompared: 'INV vs Sistema',
      message: `Payment terms differ from system: ${termsWarnings.join('; ')}.`,
    };
  }

  return {
    checkName,
    status: 'passed',
    expectedValue: '100%',
    actualValue: `Deposit=${depositPercent}%, Balance=${balancePercent}%, Days=${paymentDays}`,
    documentsCompared: dbPaymentTerms ? 'INV vs Sistema' : 'INV',
    message: 'Payment terms are valid.',
  };
}
