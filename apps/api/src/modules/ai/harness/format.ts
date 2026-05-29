/**
 * Deterministic format validators used by the AI harness.
 * Pure functions, no I/O — trivially unit-testable.
 */

/** NCM: Brazilian 8-digit code, canonical form XXXX.XX.XX (dots optional in input). */
export function isValidNcm(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  return digits.length === 8;
}

export function normalizeNcm(raw: string): string {
  const d = raw.replace(/\D/g, '');
  return d.length === 8 ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}` : raw.trim();
}

/**
 * ISO 6346 container number: 4 letters (owner+category) + 6 digits + 1 check digit.
 * Validates the check digit (mod-11) — catches OCR/hallucination errors.
 */
export function isValidContainerIso6346(raw: string): boolean {
  const s = raw.replace(/\s|-/g, '').toUpperCase();
  if (!/^[A-Z]{4}\d{7}$/.test(s)) return false;
  // Letter values per ISO 6346 (skips multiples of 11: 11,22,33).
  const letterValue: Record<string, number> = {};
  let v = 10;
  for (let i = 0; i < 26; i++) {
    if (v % 11 === 0) v++;
    letterValue[String.fromCharCode(65 + i)] = v++;
  }
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = s[i];
    const val = i < 4 ? letterValue[ch] : Number(ch);
    sum += val * Math.pow(2, i);
  }
  let check = sum % 11;
  if (check === 10) check = 0;
  return check === Number(s[10]);
}

/** Strict ISO-8601 date (YYYY-MM-DD) that is also a real calendar date. */
export function isIsoDate(raw: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const [y, m, d] = raw.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Brazilian CNPJ with check-digit validation. Accepts formatted or bare input. */
export function isValidCnpj(raw: string): boolean {
  const c = raw.replace(/\D/g, '');
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const calc = (len: number): number => {
    let sum = 0;
    let pos = len - 7;
    for (let i = len; i >= 1; i--) {
      sum += Number(c[len - i]) * pos--;
      if (pos < 2) pos = 9;
    }
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(c[12]) && calc(13) === Number(c[13]);
}

/** Currency must resolve to USD for international commercial invoices. */
export function isUsd(raw: string): boolean {
  const s = raw.trim().toUpperCase();
  return s === 'USD' || s === 'US$' || s === '$' || s === 'DOLLAR' || s === 'US DOLLAR';
}
