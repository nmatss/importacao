import { describe, it, expect } from 'vitest';
import { extractPartyParts } from '../party-extract.js';

describe('extractPartyParts', () => {
  it('separates name + address + CNPJ from a multi-line BL consignee block', () => {
    const raw = `UNI.CO COMERCIO S/A
AV PAULISTA, 1000, SAO PAULO - SP
CEP 01310-100
CNPJ: 00.399.603/0006-12
TEL: +55 11 1234-5678`;
    const r = extractPartyParts(raw);
    expect(r.name).toBe('UNI.CO COMERCIO S/A');
    expect(r.taxId).toBe('00.399.603/0006-12');
    expect(r.address).toContain('AV PAULISTA');
    expect(r.address).not.toContain('TEL');
    expect(r.address).not.toContain('00.399.603');
  });

  it('extracts shipper from blob with no CNPJ (foreign exporter)', () => {
    const raw = `KIOM INDUSTRY CO., LTD
ROOM 1903, 19/F, BUILDING 1
SHANGHAI, CHINA 200000
TEL +86 21 1234 5678`;
    const r = extractPartyParts(raw);
    expect(r.name).toBe('KIOM INDUSTRY CO., LTD');
    expect(r.address).toContain('ROOM 1903');
    expect(r.taxId).toBe('');
  });

  it('handles single-line value (name only)', () => {
    const r = extractPartyParts('KIOM GLOBAL LIMITED');
    expect(r.name).toBe('KIOM GLOBAL LIMITED');
    expect(r.address).toBe('');
    expect(r.taxId).toBe('');
  });

  it('returns empty when input is null/empty', () => {
    expect(extractPartyParts(null).name).toBe('');
    expect(extractPartyParts('').name).toBe('');
  });

  it('detects Tax ID via hint when no CNPJ format', () => {
    const raw = `KIOM INDUSTRY CO., LTD
SHANGHAI, CHINA
Tax ID: 91310112MA1G123456`;
    const r = extractPartyParts(raw);
    expect(r.taxId).toBe('91310112MA1G123456');
  });
});
