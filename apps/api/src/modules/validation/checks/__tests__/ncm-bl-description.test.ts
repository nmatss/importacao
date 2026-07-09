import { describe, it, expect } from 'vitest';
import ncmBlDescription from '../ncm-bl-description.js';

function processWithEspelhoItems(items: Array<Record<string, unknown>>) {
  return { aiExtractedData: { espelho: { items } } };
}

describe('ncm-bl-description check', () => {
  it('skips while the final OHBL is missing', () => {
    const result = ncmBlDescription({
      processData: processWithEspelhoItems([{ ncm: '61159500' }]),
    });
    expect(result.status).toBe('skipped');
    expect(result.message).toContain('OHBL');
  });

  it('skips while the Espelho has no items', () => {
    const result = ncmBlDescription({
      blData: { ncmList: ['6115'] },
      processData: { aiExtractedData: { espelho: { items: [] } } },
    });
    expect(result.status).toBe('skipped');
    expect(result.message).toContain('Espelho');
  });

  it('passes when every 4-digit Espelho prefix appears in the OHBL', () => {
    const result = ncmBlDescription({
      blData: { ncmList: ['6115.95.00', '3926'] },
      processData: processWithEspelhoItems([
        { ncm: '61159500' },
        { ncmCode: '3926.90.90' },
        // Prefixo repetido não deve gerar divergência própria.
        { classificacaoFiscal: '61151000' },
      ]),
    });
    expect(result.status).toBe('passed');
    expect(result.expectedValue).toBe('3926, 6115');
  });

  it('fails listing the Espelho prefixes absent from the OHBL', () => {
    const result = ncmBlDescription({
      blData: { ncmList: ['6115'] },
      processData: processWithEspelhoItems([{ ncm: '61159500' }, { ncm: '39269090' }]),
    });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('3926');
  });

  it('downgrades to warning when the OHBL yielded no NCM prefixes at all', () => {
    const result = ncmBlDescription({
      blData: { cargoDescription: 'SOCKS AND GIFTS' },
      processData: processWithEspelhoItems([{ ncm: '61159500' }]),
    });
    expect(result.status).toBe('warning');
    expect(result.actualValue).toBe('OHBL sem NCMs extraidas');
  });

  it('warns when the Espelho items carry no valid NCM codes', () => {
    const result = ncmBlDescription({
      blData: { ncmList: ['6115'] },
      processData: processWithEspelhoItems([{ description: 'sem ncm' }]),
    });
    expect(result.status).toBe('warning');
    expect(result.message).toContain('Espelho');
  });

  it('accepts NCMs embedded in delimited strings and 8-digit codes', () => {
    const result = ncmBlDescription({
      blData: { ncms: '6115.95.00; 3926-90-90 | 9503' },
      processData: processWithEspelhoItems([
        { ncm: '61159500' },
        { ncm: '39269090' },
        { ncm: '95030099' },
      ]),
    });
    expect(result.status).toBe('passed');
  });
});
