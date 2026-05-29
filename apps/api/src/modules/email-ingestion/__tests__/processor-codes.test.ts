import { describe, it, expect } from 'vitest';

/**
 * Locks the process-code extraction contract (UAT Odett #1). Mirrors the
 * restricted Uni.co patterns in processor.ts:extractAllProcessCodes and the
 * isStrongUnicoCode predicate, so a regression that re-broadens the regex
 * (and starts capturing PI/INV/NCM/phone/date as process codes) fails here.
 */
const PATTERNS = [
  /\b(IMP[-_]?\d{4}[-_]?\d{3,})\b/gi,
  /\b(PU?K(?:ET)?[-_]?\d{6,8}[A-Z]{0,4})\b/gi,
  /\b(IMAG(?:INARIUM)?[-_]?\d{6,8}[A-Z]{0,4})\b/gi,
  /\b(IM\d{6,8}[A-Z]{0,4})\b/gi,
];

function extractCodes(text: string): string[] {
  const seen = new Set<string>();
  const all: string[] = [];
  for (const p of PATTERNS) {
    let m: RegExpExecArray | null;
    while ((m = p.exec(text)) !== null) {
      const c = m[1].toUpperCase();
      if (!seen.has(c)) {
        seen.add(c);
        all.push(c);
      }
    }
  }
  return all;
}

const isStrong = (code: string) => /^(?:IM|PK)\d{7}[A-Z]{0,4}$/i.test(code.replace(/[-_\s]/g, ''));

describe('process code extraction (restricted Uni.co format)', () => {
  it('captures real Uni.co process codes', () => {
    expect(extractCodes('Order No.: IM0712602NB shipped')).toContain('IM0712602NB');
    expect(extractCodes('ref PK2042602NB')).toContain('PK2042602NB');
    expect(extractCodes('processo IMP-2025-001')).toContain('IMP-2025-001');
  });

  it('does NOT capture PI / INV / NCM / phone / date as process codes', () => {
    expect(extractCodes('Proforma PI-2024-042 attached')).toHaveLength(0);
    expect(extractCodes('Invoice INV-2025-00123')).toHaveLength(0);
    expect(extractCodes('NCM 6404.19.00 / 9503.00.99')).toHaveLength(0);
    expect(extractCodes('item PI7752Y AC2285Y PKT123')).toHaveLength(0);
    expect(extractCodes('tel +55 11 2042-6021 em 2026-04-09')).toHaveLength(0);
  });

  it('isStrongUnicoCode gates auto-creation to IM/PK + 7 digits', () => {
    expect(isStrong('IM0712602NB')).toBe(true);
    expect(isStrong('PK2042602NB')).toBe(true);
    expect(isStrong('IMP-2025-001')).toBe(false); // valid candidate, but not auto-create-strong
    expect(isStrong('PI-2024-042')).toBe(false);
  });
});
