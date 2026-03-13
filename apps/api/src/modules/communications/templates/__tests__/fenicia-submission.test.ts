import { describe, it, expect } from 'vitest';
import { feniciaSubmissionTemplate } from '../fenicia-submission.js';

describe('feniciaSubmissionTemplate', () => {
  it('should generate correct subject', () => {
    const result = feniciaSubmissionTemplate({
      processCode: 'IMP-2026-010',
      brand: 'puket',
    });
    expect(result.subject).toMatchSnapshot('fenicia-subject');
  });

  it('should generate body with all fields', () => {
    const result = feniciaSubmissionTemplate({
      processCode: 'IMP-2026-010',
      brand: 'puket',
      exporterName: 'Zhejiang Textiles Co.',
      importerName: 'Grupo Soma S.A.',
      totalFobValue: '45000.00',
      incoterm: 'FOB',
      totalBoxes: 120,
      portOfLoading: 'Shanghai',
      portOfDischarge: 'Santos',
      etd: '2026-04-01',
      eta: '2026-05-15',
    });
    expect(result.body).toMatchSnapshot('fenicia-body-full');
  });

  it('should generate body with minimal fields', () => {
    const result = feniciaSubmissionTemplate({
      processCode: 'IMP-2026-011',
      brand: 'imaginarium',
    });
    expect(result.body).toMatchSnapshot('fenicia-body-minimal');
  });

  it('should generate body with partial fields', () => {
    const result = feniciaSubmissionTemplate({
      processCode: 'IMP-2026-012',
      brand: 'puket',
      exporterName: 'Guangzhou Trading Ltd.',
      totalFobValue: '28000.00',
      portOfLoading: 'Ningbo',
      eta: '2026-06-20',
    });
    expect(result.body).toMatchSnapshot('fenicia-body-partial');
  });
});
