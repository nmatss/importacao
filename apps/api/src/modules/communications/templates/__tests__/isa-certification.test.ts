import { describe, it, expect } from 'vitest';
import { isaCertificationTemplate } from '../isa-certification.js';

describe('isaCertificationTemplate', () => {
  it('should generate correct subject', () => {
    const result = isaCertificationTemplate({
      processCode: 'IMP-2026-020',
      brand: 'puket',
    });
    expect(result.subject).toMatchSnapshot('isa-subject');
  });

  it('should generate body with all fields', () => {
    const result = isaCertificationTemplate({
      processCode: 'IMP-2026-020',
      brand: 'puket',
      exporterName: 'Zhejiang Textiles Co.',
      importerName: 'Grupo Soma S.A.',
      totalFobValue: '32000.00',
      totalBoxes: 85,
      eta: '2026-05-10',
    });
    expect(result.body).toMatchSnapshot('isa-body-full');
  });

  it('should generate body with minimal fields', () => {
    const result = isaCertificationTemplate({
      processCode: 'IMP-2026-021',
      brand: 'imaginarium',
    });
    expect(result.body).toMatchSnapshot('isa-body-minimal');
  });

  it('should generate body with partial fields', () => {
    const result = isaCertificationTemplate({
      processCode: 'IMP-2026-022',
      brand: 'puket',
      exporterName: 'Guangzhou Trading Ltd.',
      totalBoxes: 50,
    });
    expect(result.body).toMatchSnapshot('isa-body-partial');
  });
});
