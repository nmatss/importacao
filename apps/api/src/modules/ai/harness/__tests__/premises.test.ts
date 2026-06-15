import { describe, it, expect } from 'vitest';
import {
  cbmCeilingForContainer,
  isKnownCarrier,
  normalizeCarrier,
  _clearPremisesCache,
} from '../premises.js';
import { verifyExtraction } from '../index.js';
import { getSkill, getVerificationConfig } from '../../skills/registry.js';

const NOW = '2026-05-29T00:00:00.000Z';
const cf = (value: unknown, confidence = 0.9) => ({ value, confidence });

describe('premises — cbmCeilingForContainer', () => {
  it('usa o CBM real quando existe (40HQ=76, 20GP=33)', () => {
    _clearPremisesCache();
    expect(cbmCeilingForContainer('40HQ')).toEqual({ ceiling: 76, basis: 'real' });
    expect(cbmCeilingForContainer("40'HQ")).toEqual({ ceiling: 76, basis: 'real' }); // tolerante a apóstrofo
    expect(cbmCeilingForContainer('20GP')).toEqual({ ceiling: 33, basis: 'real' });
    expect(cbmCeilingForContainer('40NOR')).toEqual({ ceiling: 67.3, basis: 'real' });
  });

  it('cai para nominal*1.1 quando real é null (40GP)', () => {
    const c = cbmCeilingForContainer('40GP');
    expect(c?.basis).toBe('nominal');
    expect(c?.ceiling).toBeCloseTo(59 * 1.1, 5);
  });

  it('retorna null p/ tipo não tabelado / ausente (LCL, Aéreo, null, vazio)', () => {
    expect(cbmCeilingForContainer('LCL')).toBeNull();
    expect(cbmCeilingForContainer('Aéreo')).toBeNull();
    expect(cbmCeilingForContainer(null)).toBeNull();
    expect(cbmCeilingForContainer(undefined)).toBeNull();
    expect(cbmCeilingForContainer('')).toBeNull();
  });
});

describe('premises — carriers', () => {
  it('reconhece sigla, nome completo, nome sem sigla e aliases', () => {
    for (const c of [
      'HPL',
      'Hapag-Lloyd (HPL)',
      'Hapag-Lloyd',
      'MAERSK',
      'MSK',
      'HMM',
      'MOL',
      'YML',
      'ONE',
      'CMA CGM',
      'MSC',
    ]) {
      expect(isKnownCarrier(c), c).toBe(true);
    }
  });

  it('flagga armador desconhecido', () => {
    expect(isKnownCarrier('ACME LINES')).toBe(false);
  });

  it('degrada p/ vazio/curto (não refuta)', () => {
    expect(isKnownCarrier('')).toBe(true);
    expect(isKnownCarrier(null)).toBe(true);
    expect(isKnownCarrier('X')).toBe(true);
  });

  it('normalizeCarrier resolve p/ nome canônico', () => {
    expect(normalizeCarrier('HMM')).toBe('Hyundai (HMM)');
    expect(normalizeCarrier('HPL')).toBe('Hapag-Lloyd (HPL)');
    expect(normalizeCarrier('ACME')).toBeNull();
  });
});

describe('cbmVsContainerCheck wired no ohbl (config, data, source, now)', () => {
  it('40HQ/58.2 limpo; 90 excede', () => {
    const cfg = getVerificationConfig('ohbl')!;
    const data: any = { containerType: cf('40HQ'), totalCbm: cf(58.2) };
    const ok = verifyExtraction(cfg, data, '40HQ 58.2', NOW);
    expect(ok.findings.find((f) => f.field === 'totalCbm' && f.kind === 'numeric')).toBeUndefined();
    const bad = verifyExtraction(cfg, { ...data, totalCbm: cf(90) }, '40HQ 90', NOW);
    expect(bad.findings.find((f) => f.field === 'totalCbm' && f.kind === 'numeric')).toBeTruthy();
  });

  it('sem containerType (draft_bl) é no-op seguro', () => {
    const cfg = getVerificationConfig('draft_bl')!;
    const data: any = { totalCbm: cf(58.4) };
    const r = verifyExtraction(cfg, data, '58.4', NOW);
    expect(r.findings.find((f) => f.field === 'totalCbm' && f.kind === 'numeric')).toBeUndefined();
  });
});

describe('carrierKnownCheck wired no espelho', () => {
  it('MAERSK limpo; ACME LINES flagga', () => {
    const cfg = getVerificationConfig('espelho')!;
    const data: any = { shippingLine: cf('MAERSK'), items: [] };
    const ok = verifyExtraction(cfg, data, 'shipping line MAERSK', NOW);
    expect(
      ok.findings.find((f) => f.field === 'shippingLine' && f.kind === 'numeric'),
    ).toBeUndefined();
    const bad = verifyExtraction(
      cfg,
      { ...data, shippingLine: cf('ACME LINES') },
      'shipping line ACME LINES',
      NOW,
    );
    expect(
      bad.findings.find((f) => f.field === 'shippingLine' && f.kind === 'numeric'),
    ).toBeTruthy();
  });
});

describe('gold fewShots permanecem verdes', () => {
  for (const type of ['ohbl', 'draft_bl', 'espelho']) {
    it(`${type}: parseia no schema, zero erro, sem falso positivo cbm/carrier`, () => {
      const skill = getSkill(type)!;
      const parsed = skill.schema.parse(JSON.parse(skill.fewShot![0].json));
      // source que cobre todos os value para não gerar ruído de grounding
      const parts: string[] = [];
      const walk = (v: any): void => {
        if (v == null) return;
        if (Array.isArray(v)) {
          v.forEach(walk);
          return;
        }
        if (typeof v === 'object') {
          if ('value' in v) walk(v.value);
          else Object.values(v).forEach(walk);
          return;
        }
        parts.push(String(v));
      };
      walk(parsed);
      const report = verifyExtraction(skill.verification, parsed as any, parts.join(' '), NOW);
      expect(report.findings.filter((f) => f.severity === 'error')).toEqual([]);
      expect(
        report.findings.find((f) => f.field === 'totalCbm' && f.kind === 'numeric'),
      ).toBeUndefined();
      expect(
        report.findings.find(
          (f) => (f.field === 'shippingLine' || f.field === 'carrier') && f.kind === 'numeric',
        ),
      ).toBeUndefined();
    });
  }
});
