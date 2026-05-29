import { describe, it, expect } from 'vitest';
import { isValidNcm, isValidContainerIso6346, isIsoDate, isValidCnpj, isUsd } from '../format.js';
import { appearsInSource, normalizeForGrounding } from '../grounding.js';
import { verifyExtraction } from '../index.js';
import { getVerificationConfig } from '../../skills/registry.js';
import type { VerificationConfig } from '../types.js';

const NOW = '2026-05-29T00:00:00.000Z';
const cf = (value: unknown, confidence = 0.9) => ({ value, confidence });

describe('format validators', () => {
  it('validates NCM (8 digits, dotted or bare)', () => {
    expect(isValidNcm('6404.19.00')).toBe(true);
    expect(isValidNcm('64041900')).toBe(true);
    expect(isValidNcm('640419')).toBe(false);
  });

  it('validates ISO 6346 container check digit', () => {
    expect(isValidContainerIso6346('CSQU3054383')).toBe(true); // canonical example
    expect(isValidContainerIso6346('CSQU3054384')).toBe(false); // wrong check digit
    expect(isValidContainerIso6346('ABC123')).toBe(false);
  });

  it('validates strict ISO dates', () => {
    expect(isIsoDate('2026-04-09')).toBe(true);
    expect(isIsoDate('09/04/2026')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
  });

  it('validates CNPJ check digits', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11.222.333/0001-00')).toBe(false);
    expect(isValidCnpj('00000000000000')).toBe(false);
  });

  it('recognizes USD', () => {
    expect(isUsd('USD')).toBe(true);
    expect(isUsd('us$')).toBe(true);
    expect(isUsd('BRL')).toBe(false);
  });
});

describe('grounding', () => {
  it('normalizes alphanumerically', () => {
    expect(normalizeForGrounding('PI 7752-Y')).toBe('PI7752Y');
  });
  it('detects grounded vs hallucinated values', () => {
    const src = 'COMMERCIAL INVOICE No. IM0712602NB ... item PI7752Y blouse';
    expect(appearsInSource('IM0712602NB', src)).toBe(true);
    expect(appearsInSource('pi-7752-y', src)).toBe(true);
    expect(appearsInSource('ZZ9999X', src)).toBe(false);
  });
});

describe('verifyExtraction', () => {
  const config: VerificationConfig = {
    groundedFields: ['invoiceNumber', 'items[].itemCode'],
    ncmFields: ['items[].ncmCode'],
    dateFields: ['invoiceDate'],
    usdCurrencyFields: ['currency'],
  };

  it('trusts a fully grounded, well-formed extraction', () => {
    const source = 'INVOICE INV-77 date 2026-04-09 USD item ABC123 ncm 6404.19.00';
    const data = {
      invoiceNumber: cf('INV-77'),
      invoiceDate: cf('2026-04-09'),
      currency: cf('USD'),
      items: [{ itemCode: cf('ABC123'), ncmCode: cf('6404.19.00') }],
    };
    const report = verifyExtraction(config, data, source, NOW);
    expect(report.trust).toBe('trusted');
    expect(report.findings).toHaveLength(0);
  });

  it('flags a hallucinated invoice number and bad NCM/date/currency', () => {
    const source = 'INVOICE real content with item ABC123 only';
    const data = {
      invoiceNumber: cf('GHOST-999'), // not in source → grounding error
      invoiceDate: cf('09/04/2026'), // bad format → warning
      currency: cf('BRL'), // not USD → warning
      items: [{ itemCode: cf('ABC123'), ncmCode: cf('123') }], // bad NCM → error
    };
    const report = verifyExtraction(config, data, source, NOW);
    expect(report.trust).toBe('review');
    expect(report.reviewFields).toContain('invoiceNumber');
    expect(report.findings.some((f) => f.kind === 'grounding')).toBe(true);
    expect(report.adjustedConfidence).toBeLessThan(1);
  });
});

describe('packing list quantity integer check (UAT #8)', () => {
  it('flags a decimal item quantity (price read as quantity)', () => {
    const config = getVerificationConfig('packing_list') as VerificationConfig;
    const data = { items: [{ itemCode: cf('ABC123'), quantity: cf(25.5) }] };
    const report = verifyExtraction(config, data, 'source with ABC123', NOW);
    expect(report.findings.some((f) => f.kind === 'numeric')).toBe(true);
  });

  it('accepts an integer item quantity', () => {
    const config = getVerificationConfig('packing_list') as VerificationConfig;
    const data = { items: [{ itemCode: cf('ABC123'), quantity: cf(500) }] };
    const report = verifyExtraction(config, data, 'source with ABC123', NOW);
    expect(report.findings.some((f) => f.kind === 'numeric')).toBe(false);
  });
});
