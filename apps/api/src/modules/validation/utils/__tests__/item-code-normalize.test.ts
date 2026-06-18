import { describe, it, expect } from 'vitest';
import {
  normalizeItemCode,
  itemCodesMatch,
  extractCanonicalItemCode,
  cleanItemCodesInAiData,
} from '../item-code-normalize.js';

describe('normalizeItemCode', () => {
  it('strips whitespace', () => {
    expect(normalizeItemCode('PI 7752Y')).toBe('PI7752Y');
  });

  it('strips dashes', () => {
    expect(normalizeItemCode('PI-7752Y')).toBe('PI7752Y');
  });

  it('strips dots and slashes', () => {
    expect(normalizeItemCode('PI.7752Y')).toBe('PI7752Y');
    expect(normalizeItemCode('PI/7752Y')).toBe('PI7752Y');
  });

  it('uppercases', () => {
    expect(normalizeItemCode('pi7752y')).toBe('PI7752Y');
  });

  it('strips FAT invoice/packing-list prefixes before item codes', () => {
    expect(normalizeItemCode('FAT03PI7765Y')).toBe('PI7765Y');
    expect(normalizeItemCode('FAT02 AC 2285Y')).toBe('AC2285Y');
  });

  it('returns empty string for null', () => {
    expect(normalizeItemCode(null)).toBe('');
    expect(normalizeItemCode(undefined)).toBe('');
  });
});

describe('itemCodesMatch', () => {
  it('resolves the PI7752Y mismatch reported by Nicolas', () => {
    expect(itemCodesMatch('PI7752Y', 'PI 7752Y')).toBe(true);
    expect(itemCodesMatch('PI7752Y', 'PI-7752Y')).toBe(true);
    expect(itemCodesMatch('pi7752y', 'PI7752Y')).toBe(true);
  });

  it('returns false for genuinely different codes', () => {
    expect(itemCodesMatch('PI7752Y', 'PI7753Y')).toBe(false);
  });

  it('returns false for empty inputs', () => {
    expect(itemCodesMatch('', 'PI7752Y')).toBe(false);
    expect(itemCodesMatch(null, 'PI7752Y')).toBe(false);
  });
});

describe('extractCanonicalItemCode', () => {
  it('strips collection/season column bleed (the Nicolas bug)', () => {
    expect(extractCanonicalItemCode('FALL/24 PI7752Y')).toBe('PI7752Y');
    expect(extractCanonicalItemCode('SS25 AC2285Y')).toBe('AC2285Y');
  });

  it('strips packaging column bleed', () => {
    expect(extractCanonicalItemCode('WHITE BOX PI7752Y')).toBe('PI7752Y');
    expect(extractCanonicalItemCode('PI7752Y POLYBAG')).toBe('PI7752Y');
  });

  it('strips FAT prefixes from compact packing-list codes', () => {
    expect(extractCanonicalItemCode('FAT03PI7765Y')).toBe('PI7765Y');
  });

  it('leaves plain canonical codes alone', () => {
    expect(extractCanonicalItemCode('PI7752Y')).toBe('PI7752Y');
    expect(extractCanonicalItemCode('AC2285Y')).toBe('AC2285Y');
  });

  it('leaves unrecognized codes alone (no false strip)', () => {
    expect(extractCanonicalItemCode('SOMETHING_WEIRD')).toBe('SOMETHING_WEIRD');
    expect(extractCanonicalItemCode('12345')).toBe('12345');
  });

  it('does not arbitrarily pick when multiple canonical codes appear', () => {
    expect(extractCanonicalItemCode('PI7752Y PI7753Y')).toBe('PI7752Y PI7753Y');
  });

  it('returns empty for null/empty', () => {
    expect(extractCanonicalItemCode(null)).toBe('');
    expect(extractCanonicalItemCode('')).toBe('');
  });
});

describe('cleanItemCodesInAiData', () => {
  it('cleans wrapped {value, confidence} item codes', () => {
    const data = {
      items: [
        { itemCode: { value: 'FALL/24 PI7752Y', confidence: 0.7 } },
        { itemCode: { value: 'AC2285Y', confidence: 0.9 } },
      ],
    };
    cleanItemCodesInAiData(data);
    expect(data.items[0].itemCode.value).toBe('PI7752Y');
    expect(data.items[1].itemCode.value).toBe('AC2285Y');
  });

  it('cleans plain string item codes', () => {
    const data = { items: [{ itemCode: 'WHITE BOX PI7752Y' }] };
    cleanItemCodesInAiData(data);
    expect(data.items[0].itemCode).toBe('PI7752Y');
  });

  it('is a noop when items is missing', () => {
    const data = { foo: 'bar' };
    expect(cleanItemCodesInAiData(data)).toBe(data);
  });
});
