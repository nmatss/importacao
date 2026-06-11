import { describe, it, expect } from 'vitest';
import {
  createEanIndex,
  lookupEan,
  normalizeItemCode,
  getDefaultEanIndex,
  _clearEanIndexCache,
} from '../ean-lookup.js';

// Small mock of the real ean.json shape (puket rows: ean/product/grade/color/line).
const KB_ROWS = [
  { ean: '7909692093303', product: '10604232', grade: '34 A 39', color: '100', line: 'MEIAS' },
  { ean: '7909692093310', product: '10604232', grade: '40 A 44', color: '100', line: 'MEIAS' },
  { ean: '7891276565590', product: '10603760', grade: '34 A 39', color: '320', line: 'MEIAS' },
  // Single-EAN product — unambiguous without color/size.
  { ean: '96385074', product: 'AC2285Y', grade: null, color: null, line: 'ACESSORIOS' },
  // Invalid EANs must be dropped at index time (real KB has empty + '276079' noise).
  { ean: '', product: '27030001', grade: 'U', color: '100', line: 'MEIAS' },
  { ean: '276079', product: '27030002', grade: 'U', color: '100', line: 'MEIAS' },
  { ean: '7909692093304', product: '27030003', grade: 'U', color: '100', line: 'MEIAS' }, // bad check digit
];

describe('normalizeItemCode', () => {
  it('uppercases and strips separators', () => {
    expect(normalizeItemCode('pi 7752-y')).toBe('PI7752Y');
    expect(normalizeItemCode('10.604.232')).toBe('10604232');
    expect(normalizeItemCode(null)).toBe('');
    expect(normalizeItemCode(undefined)).toBe('');
  });
});

describe('createEanIndex / lookupEan', () => {
  const index = createEanIndex(KB_ROWS);

  it('indexes by normalized product code and drops invalid EANs', () => {
    expect(index.get('10604232')).toHaveLength(2);
    expect(index.has('27030001')).toBe(false); // empty ean
    expect(index.has('27030002')).toBe(false); // bad length
    expect(index.has('27030003')).toBe(false); // bad check digit
  });

  it('returns the EAN when the product has a single candidate', () => {
    expect(lookupEan(index, 'AC2285Y')).toBe('96385074');
    expect(lookupEan(index, 'ac 2285-y')).toBe('96385074'); // normalized lookup
    expect(lookupEan(index, '10603760')).toBe('7891276565590');
  });

  it('disambiguates multi-EAN products by size (grade)', () => {
    expect(lookupEan(index, '10604232')).toBe(null); // ambiguous — never guess
    expect(lookupEan(index, '10604232', { size: '34 A 39' })).toBe('7909692093303');
    expect(lookupEan(index, '10604232', { size: '40A44' })).toBe('7909692093310');
  });

  it('returns null for unknown codes and empty input', () => {
    expect(lookupEan(index, 'ZZ9999X')).toBe(null);
    expect(lookupEan(index, '')).toBe(null);
    expect(lookupEan(index, null)).toBe(null);
  });

  it('ignores a non-matching color filter instead of failing the lookup', () => {
    // color '999' matches no KB row → filter is dropped, product is still
    // single-EAN ambiguity-wise for 10603760.
    expect(lookupEan(index, '10603760', { color: '999' })).toBe('7891276565590');
  });
});

describe('getDefaultEanIndex', () => {
  it('loads the real ean.json KB and memoizes it', () => {
    _clearEanIndexCache();
    const index = getDefaultEanIndex();
    expect(index.size).toBeGreaterThan(0); // Puket base is populated
    expect(getDefaultEanIndex()).toBe(index); // memoized
    _clearEanIndexCache();
  });
});
