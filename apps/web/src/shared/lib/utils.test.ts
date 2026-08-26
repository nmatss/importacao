import { describe, expect, it } from 'vitest';
import { formatCurrency } from './utils';

describe('formatCurrency', () => {
  it('formats ISO 4217 currency codes normally', () => {
    expect(formatCurrency(1234.56, 'usd')).toMatch(/US\$\s?1\.234,56/);
  });

  it('does not throw when an external source sends a non-currency label', () => {
    expect(formatCurrency(1234.56, 'PREPAID')).toBe('1.234,56 PREPAID');
  });
});
