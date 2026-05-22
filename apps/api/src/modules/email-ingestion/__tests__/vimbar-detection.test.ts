import { describe, it, expect } from 'vitest';

// Pure regex sanity for the Vimbar-approval detector. Mirrors the patterns
// used inline in processor.ts so the contract is locked even if the inline
// code is refactored later.
const VIMBAR_RE = /\bvimbar\b/i;
const APPROVAL_RE = /\b(aprov|approv|liberad|libera[cç][aã]o)/i;

function isVimbarApproval(subject: string, body = '') {
  const haystack = `${subject}\n${body}`;
  return VIMBAR_RE.test(haystack) && APPROVAL_RE.test(haystack);
}

describe('Vimbar approval detection', () => {
  it('matches the typical "Aprovação Vimbar - <ref>" subject', () => {
    expect(isVimbarApproval('Aprovação Vimbar - IM0712602NB')).toBe(true);
    expect(isVimbarApproval('Aprovacao Vimbar IM0742605SZ')).toBe(true);
  });

  it('matches when the approval signal is in the body', () => {
    expect(
      isVimbarApproval('Vimbar - processo IMxxx', 'Olá, segue aprovado o embarque IMxxx.'),
    ).toBe(true);
  });

  it('accepts the English variant "approved"', () => {
    expect(isVimbarApproval('Vimbar approved - shipment XYZ')).toBe(true);
  });

  it('does NOT match a Vimbar email without approval keyword', () => {
    expect(isVimbarApproval('Vimbar - documentos pendentes', 'Faltam ainda 2 docs.')).toBe(false);
  });

  it('does NOT match an approval email unrelated to Vimbar', () => {
    expect(isVimbarApproval('Pedido aprovado pelo financeiro')).toBe(false);
  });

  it('case-insensitive', () => {
    expect(isVimbarApproval('VIMBAR LIBERADO - IM0732604NB')).toBe(true);
  });
});
