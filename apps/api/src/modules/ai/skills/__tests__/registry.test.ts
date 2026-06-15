import { describe, it, expect } from 'vitest';
import { getSkill, getVerificationConfig } from '../registry.js';
import { verifyExtraction } from '../../harness/index.js';

// All document types that must have a fully-populated specialist skill.
const SPECIALIST_DOC_TYPES = [
  'invoice',
  'packing_list',
  'ohbl',
  'draft_bl',
  'proforma_invoice',
  'espelho',
  'certificate',
  'li',
];

describe('specialist skill registry', () => {
  for (const docType of SPECIALIST_DOC_TYPES) {
    describe(docType, () => {
      const skill = getSkill(docType);

      it('is registered with the specialist layer populated', () => {
        expect(skill).not.toBeNull();
        expect(skill!.domainRules?.trim().length).toBeGreaterThan(0);
        expect(skill!.fewShot?.length).toBeGreaterThan(0);
        expect(skill!.retrieval?.namespaces.length).toBeGreaterThan(0);
      });

      it('every gold few-shot parses against the skill schema (correct shape)', () => {
        for (const ex of skill!.fewShot ?? []) {
          const data = JSON.parse(ex.json);
          const parsed = skill!.schema.safeParse(data);
          if (!parsed.success) {
            throw new Error(
              `${docType} few-shot inválido: ${JSON.stringify(parsed.error.issues, null, 2)}`,
            );
          }
          expect(parsed.success).toBe(true);
        }
      });

      it('retrieval namespaces map to real knowledge-base files', () => {
        const KB = ['ncms', 'parties', 'ports', 'carriers', 'ean', 'premissas'];
        for (const ns of skill!.retrieval?.namespaces ?? []) {
          expect(KB).toContain(ns);
        }
      });
    });
  }

  it('FOC items are excluded from the declared total (invoice + proforma gold)', () => {
    for (const docType of ['invoice', 'proforma_invoice']) {
      const data = JSON.parse(getSkill(docType)!.fewShot![0].json);
      const nonFoc = data.items.filter((i: any) => i.isFreeOfCharge?.value !== true);
      const sum = nonFoc.reduce((acc: number, i: any) => acc + i.totalPrice.value, 0);
      expect(sum).toBe(data.totalFobValue.value);
    }
  });

  // The decisive gate: run each gold few-shot THROUGH THE HARNESS (using the
  // gold itself as source so grounding is satisfied). If the authoritative
  // example self-flags a format error (bad CNPJ/NCM/container check digit), the
  // skill is teaching the model something its own trust layer would reject.
  // This is what catches the whole class — scoreExtraction(gold,gold) cannot.
  it('every gold few-shot passes its own harness with zero error findings', () => {
    for (const docType of SPECIALIST_DOC_TYPES) {
      const skill = getSkill(docType)!;
      const config = getVerificationConfig(docType)!;
      const source = skill.fewShot![0].json;
      const gold = JSON.parse(source);
      const report = verifyExtraction(config, gold, source, '2026-06-14T00:00:00.000Z');
      const errors = report.findings.filter((f) => f.severity === 'error');
      if (errors.length > 0) {
        throw new Error(`${docType} gold self-flags: ${JSON.stringify(errors)}`);
      }
      expect(errors).toEqual([]);
    }
  });

  it('numeric totals are internally consistent (espelho sums, PL weights/boxes)', () => {
    const esp = JSON.parse(getSkill('espelho')!.fewShot![0].json);
    const sum = (k: string) => esp.items.reduce((a: number, i: any) => a + (i[k]?.value ?? 0), 0);
    expect(sum('amountUsd')).toBe(esp.totalAmountUsd.value);
    expect(sum('caixasPorRef')).toBe(esp.totalBoxes.value);
    expect(sum('pesoBrutoTotal')).toBe(esp.totalGrossWeight.value);
    expect(sum('pesoLiquidoTotal')).toBe(esp.totalNetWeight.value);

    const pl = JSON.parse(getSkill('packing_list')!.fewShot![0].json);
    const plSum = (k: string) => pl.items.reduce((a: number, i: any) => a + (i[k]?.value ?? 0), 0);
    expect(plSum('boxQuantity')).toBe(pl.totalBoxes.value);
    expect(plSum('netWeight')).toBe(pl.totalNetWeight.value);
    expect(plSum('grossWeight')).toBe(pl.totalGrossWeight.value);
  });
});
