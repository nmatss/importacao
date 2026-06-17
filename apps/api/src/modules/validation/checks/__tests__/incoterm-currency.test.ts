import { describe, expect, it } from 'vitest';
import currencyCheck from '../currency-check.js';
import incotermCheck from '../incoterm-check.js';

describe('incoterm-check', () => {
  it.each(['FOB', 'FOB NINGBO', 'FOB - CHINA', 'Incoterm: FOB / Ningbo'])(
    'passes common FOB variant %s',
    (incoterm) => {
      const result = incotermCheck({ invoiceData: { incoterm } });

      expect(result.status).toBe('passed');
      expect(result.expectedValue).toBe('FOB');
    },
  );

  it('fails non-FOB terms after extracting the base code', () => {
    const result = incotermCheck({ invoiceData: { incoterm: 'CIF Santos' } });

    expect(result.status).toBe('failed');
    expect(result.actualValue).toBe('CIF SANTOS');
  });
});

describe('currency-check', () => {
  it.each(['USD', 'US$', 'U.S.D.', 'USD DOLLARS', 'United States Dollars'])(
    'passes common USD variant %s',
    (currency) => {
      const result = currencyCheck({ invoiceData: { currency } });

      expect(result.status).toBe('passed');
      expect(result.expectedValue).toBe('USD');
    },
  );

  it('fails non-USD currencies after extracting the base code', () => {
    const result = currencyCheck({ invoiceData: { currency: 'EUR' } });

    expect(result.status).toBe('failed');
    expect(result.actualValue).toBe('EUR');
  });
});
