import { describe, expect, it } from 'vitest';

import { detectDocType } from './DocumentUpload';

describe('detectDocType', () => {
  it('prioritizes Draft BL over generic BL keywords', () => {
    expect(detectDocType('draft bl processo 123.pdf')).toBe('draft_bl');
    expect(detectDocType('draftBL-processo-123.pdf')).toBe('draft_bl');
    expect(detectDocType('rascunho_bl_processo_123.pdf')).toBe('draft_bl');
  });

  it('matches short document tokens only as whole tokens', () => {
    expect(detectDocType('INV-001.pdf')).toBe('invoice');
    expect(detectDocType('commercial invoice.pdf')).toBe('invoice');
    expect(detectDocType('validacao-produto.pdf')).toBe('other');
  });
});
