import { describe, expect, it } from 'vitest';

import manufacturerCompleteness from '../manufacturer-completeness.js';

describe('manufacturerCompleteness', () => {
  it('uses manufacturer suffixes embedded in invoice item descriptions', () => {
    const result = manufacturerCompleteness({
      invoiceData: {
        items: [
          {
            itemCode: 'PI7765Y',
            description: 'LANTERNA DE LED --FINE TEXTILE',
          },
          {
            itemCode: 'AC2285Y',
            description: 'BOLSA TERMICA --A&C',
          },
        ],
      },
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('nome do fabricante ausente');
  });

  it('does not accept generic FOC suffixes as manufacturer data', () => {
    const result = manufacturerCompleteness({
      invoiceData: {
        items: [
          {
            itemCode: 'PI7795Y',
            description: 'KIT PROMOCIONAL --FREE OF CHARGE',
          },
        ],
      },
    });

    expect(result.status).toBe('failed');
  });
});
