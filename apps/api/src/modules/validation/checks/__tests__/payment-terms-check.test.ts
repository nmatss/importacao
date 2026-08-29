import { describe, expect, it } from 'vitest';

import paymentTermsCheck from '../payment-terms-check.js';

describe('payment-terms-check', () => {
  it('passes when deposit + balance = 100%', () => {
    const result = paymentTermsCheck({
      invoiceData: { paymentTerms: { depositPercent: 30, balancePercent: 70, paymentDays: 30 } },
    });

    expect(result.status).toBe('passed');
  });

  it('does not turn a non-extracted percentage into a hard failure', () => {
    // `Number(x ?? 0)`: com depositPercent=30 e balancePercent ausente a soma
    // dava 30 e o check devolvia `failed` "esperado 100%".
    const result = paymentTermsCheck({
      invoiceData: { paymentTerms: { depositPercent: 30 } },
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('Condicao de pagamento incompleta');
    expect(result.actualValue).toContain('Balance=nao extraido');
  });

  it('still fails when both percentages are present and do not add up', () => {
    const result = paymentTermsCheck({
      invoiceData: { paymentTerms: { depositPercent: 30, balancePercent: 60 } },
    });

    expect(result.status).toBe('failed');
    expect(result.message).toContain('esperado 100%');
  });

  it('treats an explicit zero deposit as a value, not as a missing field', () => {
    const result = paymentTermsCheck({
      invoiceData: { paymentTerms: { depositPercent: 0, balancePercent: 100 } },
    });

    expect(result.status).toBe('passed');
  });

  it('reads percentages written as text', () => {
    const result = paymentTermsCheck({
      invoiceData: { paymentTerms: { depositPercent: '30%', balancePercent: '70%' } },
    });

    expect(result.status).toBe('passed');
  });

  it('warns when the payment days are present but unreadable', () => {
    const result = paymentTermsCheck({
      invoiceData: {
        paymentTerms: { depositPercent: 30, balancePercent: 70, paymentDays: 'a combinar' },
      },
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('nao interpretaveis');
  });

  it('still fails when the invoice explicitly declares zero payment days', () => {
    const result = paymentTermsCheck({
      invoiceData: { paymentTerms: { depositPercent: 30, balancePercent: 70, paymentDays: 0 } },
    });

    expect(result.status).toBe('failed');
    expect(result.message).toContain('esperado > 0');
  });
});
