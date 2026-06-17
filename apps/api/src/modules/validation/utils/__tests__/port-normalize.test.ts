import { describe, it, expect } from 'vitest';
import { normalizePort, portsMatch } from '../port-normalize.js';

describe('normalizePort', () => {
  it('lowercases and strips whitespace', () => {
    expect(normalizePort('  Shanghai  ')).toBe('shanghai');
  });

  it('strips country suffix after comma', () => {
    expect(normalizePort('NINGBO, CHINA')).toBe('ningbo');
    expect(normalizePort('ITAPOA, BRAZIL')).toBe('itapoa');
    expect(normalizePort('Itapoa, Brasil')).toBe('itapoa');
  });

  it('strips country suffix after dash', () => {
    expect(normalizePort('Shanghai - China')).toBe('shanghai');
    expect(normalizePort('SANTOS - BRASIL')).toBe('santos');
  });

  it('strips country suffix after slash and parentheses', () => {
    expect(normalizePort('NAVEGANTES/BRASIL')).toBe('navegantes');
    expect(normalizePort('NINGBO (P.R. CHINA)')).toBe('ningbo');
  });

  it('strips country suffix after whitespace only', () => {
    expect(normalizePort('NINGBO CHINA')).toBe('ningbo');
    expect(normalizePort('ITAPOA BRAZIL')).toBe('itapoa');
    expect(normalizePort('NINGBO CN')).toBe('ningbo');
    expect(normalizePort('ITAPOA BR')).toBe('itapoa');
  });

  it('handles multi-word countries', () => {
    expect(normalizePort('Los Angeles, United States')).toBe('los angeles');
    expect(normalizePort('Hong Kong, Hong Kong')).toBe('hong kong');
  });

  it('removes accents before comparison', () => {
    expect(normalizePort('ITAPOÁ, BRAZIL')).toBe('itapoa');
    expect(portsMatch('ITAPOA', 'ITAPOÁ, BRAZIL')).toBe(true);
  });

  it('returns empty string for null/undefined', () => {
    expect(normalizePort(null)).toBe('');
    expect(normalizePort(undefined)).toBe('');
    expect(normalizePort('')).toBe('');
  });
});

describe('portsMatch', () => {
  it('returns true for the Nicolas-reported false positive: NINGBO vs NINGBO, CHINA', () => {
    expect(portsMatch('NINGBO', 'NINGBO, CHINA')).toBe(true);
  });

  it('returns true for ITAPOA vs ITAPOA, BRAZIL', () => {
    expect(portsMatch('ITAPOA', 'ITAPOA, BRAZIL')).toBe(true);
  });

  it('returns true for identical normalized ports', () => {
    expect(portsMatch('Shanghai', 'shanghai')).toBe(true);
  });

  it('returns false for genuinely different ports', () => {
    expect(portsMatch('Shanghai', 'Ningbo')).toBe(false);
  });

  it('does not accept unsafe prefix matches as equal ports', () => {
    expect(portsMatch('SANTOS', 'SANTOS DUMONT')).toBe(false);
  });

  it('returns false when either value is empty', () => {
    expect(portsMatch('', 'Shanghai')).toBe(false);
    expect(portsMatch('Shanghai', null)).toBe(false);
  });
});
