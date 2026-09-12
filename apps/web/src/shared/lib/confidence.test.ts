import { describe, expect, it } from 'vitest';
import { isDocumentOperational } from './confidence';

describe('corte operacional por tipo de documento', () => {
  it.each(['ohbl', 'draft_bl'])('%s exige 90% inclusive e confiança conhecida', (type) => {
    expect(isDocumentOperational(0.89, type)).toBe(false);
    expect(isDocumentOperational(0.9, type)).toBe(true);
    expect(isDocumentOperational(null, type)).toBe(false);
    expect(isDocumentOperational('inválido', type)).toBe(false);
  });
  it('preserva o corte de outros documentos', () => {
    expect(isDocumentOperational(0.4, 'invoice')).toBe(true);
    expect(isDocumentOperational(0.39, 'packing_list')).toBe(false);
  });
});
