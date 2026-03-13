import { describe, it, expect } from 'vitest';
import { kiomCorrectionTemplate } from '../kiom-correction.js';

describe('kiomCorrectionTemplate', () => {
  it('should generate correct subject', () => {
    const result = kiomCorrectionTemplate({
      processCode: 'IMP-2026-001',
      brand: 'puket',
      failedChecks: [
        {
          checkName: 'fob-value-match',
          expectedValue: '10000.00',
          actualValue: '9500.00',
          message: 'FOB value mismatch between INV and PL',
        },
      ],
    });
    expect(result.subject).toMatchSnapshot('correction-subject');
  });

  it('should generate correct body with single failure', () => {
    const result = kiomCorrectionTemplate({
      processCode: 'IMP-2026-001',
      brand: 'puket',
      failedChecks: [
        {
          checkName: 'fob-value-match',
          expectedValue: '10000.00',
          actualValue: '9500.00',
          message: 'FOB value mismatch between INV and PL',
        },
      ],
    });
    expect(result.body).toMatchSnapshot('correction-body-single');
  });

  it('should generate correct body with multiple failures', () => {
    const result = kiomCorrectionTemplate({
      processCode: 'IMP-2026-002',
      brand: 'imaginarium',
      failedChecks: [
        {
          checkName: 'fob-value-match',
          expectedValue: '10000.00',
          actualValue: '9500.00',
          message: 'FOB value mismatch',
        },
        {
          checkName: 'net-weight-match',
          expectedValue: '500.000',
          actualValue: '480.000',
          message: 'Net weight mismatch',
        },
        {
          checkName: 'exporter-name-match',
          message: 'Exporter name differs between documents',
        },
      ],
    });
    expect(result.body).toMatchSnapshot('correction-body-multiple');
  });

  it('should handle checks without expected/actual values', () => {
    const result = kiomCorrectionTemplate({
      processCode: 'IMP-2026-003',
      brand: 'puket',
      failedChecks: [
        {
          checkName: 'ports-match',
          message: 'Port of loading mismatch',
        },
      ],
    });
    expect(result.body).toMatchSnapshot('correction-body-no-values');
  });
});
