import { describe, it, expect } from 'vitest';
import {
  isValidNcm,
  isValidContainerIso6346,
  isIsoDate,
  isValidCnpj,
  isUsd,
  isValidGtin,
  normalizeGtin,
} from '../format.js';
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

  it('validates GTIN/EAN check digit (8/12/13/14 digits)', () => {
    expect(isValidGtin('7909692093303')).toBe(true); // EAN-13 from Base EAN Puket
    expect(isValidGtin('7909692093304')).toBe(false); // wrong check digit
    expect(isValidGtin('96385074')).toBe(true); // EAN-8
    expect(isValidGtin('036000291452')).toBe(true); // UPC-A (12 digits)
    expect(isValidGtin('07909692093303')).toBe(true); // GTIN-14 (leading zero)
    expect(isValidGtin('276079')).toBe(false); // bad length (real KB noise)
    expect(isValidGtin('ABC9692093303')).toBe(false); // non-numeric
  });

  it('normalizes GTIN to bare digits, rejecting invalid ones', () => {
    expect(normalizeGtin('790 9692 093303')).toBe('7909692093303');
    expect(normalizeGtin('7909692-093303')).toBe('7909692093303');
    expect(normalizeGtin('7909692093304')).toBe(null); // bad check digit → absent
    expect(normalizeGtin('')).toBe(null);
    expect(normalizeGtin(null)).toBe(null);
    expect(normalizeGtin(undefined)).toBe(null);
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

describe('invoice total harness', () => {
  it('excludes explicit FOC items from the declared FOB total', () => {
    const config = getVerificationConfig('invoice') as VerificationConfig;
    const data = {
      totalFobValue: cf(1020),
      items: [
        { totalPrice: cf(1020), isFreeOfCharge: cf(false) },
        { totalPrice: cf(266.4), isFreeOfCharge: cf(true) },
      ],
    };

    const report = verifyExtraction(config, data, 'commercial invoice', NOW);

    expect(report.findings.filter((f) => f.kind === 'numeric')).toEqual([]);
  });

  it('flags the same total when the FOC marker is missing', () => {
    const config = getVerificationConfig('invoice') as VerificationConfig;
    const data = {
      totalFobValue: cf(1020),
      items: [{ totalPrice: cf(1020) }, { totalPrice: cf(266.4) }],
    };

    const report = verifyExtraction(config, data, 'commercial invoice', NOW);

    expect(report.findings).toContainEqual(
      expect.objectContaining({
        field: 'totalFobValue',
        kind: 'numeric',
        severity: 'error',
      }),
    );
  });
});

/**
 * EXT-02 (reunião 11/09/2026) — "ele nem leu, disse que era para desconsiderar...
 * ficou 39, não utilizável". O OHBL do PK220 (doc 169) tinha sido extraído
 * CORRETAMENTE; quem o derrubou foram falsos positivos do próprio harness.
 */
describe('harness do BL — falsos positivos que zeravam um OHBL correto', () => {
  const ohbl = () => getVerificationConfig('ohbl') as VerificationConfig;

  // Estrutura do documento real: os dois contêineres aparecem em LINHAS
  // separadas, e o BL imprime a posição do SH com 4 dígitos.
  const source = `OCEAN BILL OF LADING
B/L No.: SHYY26080651
ORDER NO.: PK2202608SZ
CNTR/SEAL NO/SIZE/PIECES/KGS/CBM
MNBU3949421 / 26H0011711 / 40NOR / 700 CARTONS
MNBU0184030 / 26H0011712 / 40NOR / 675 CARTONS
NCM NO.: 4202
SAY TWO (2X40NOR) CONTAINERS ONLY
TOTAL: 1375 CARTONS / 13997.48KGS / 120.246CBM`;

  const data = () => ({
    blNumber: cf('SHYY26080651', 0.98),
    customerReference: cf('PK2202608SZ', 0.95),
    containerNumber: cf('MNBU3949421,MNBU0184030', 0.95),
    containerType: cf('40NOR', 0.9),
    totalCbm: cf(120.246, 0.9),
    ncmList: cf(['4202'], 0.9),
  });

  it('aceita a lista de contêineres com cada parte presente no documento', () => {
    const report = verifyExtraction(ohbl(), data(), source, NOW);
    expect(report.findings.filter((f) => f.kind === 'grounding')).toHaveLength(0);
  });

  it('continua reprovando quando UM dos contêineres não está no documento', () => {
    const parcial = { ...data(), containerNumber: cf('MNBU3949421,MSKU7654321', 0.95) };
    const report = verifyExtraction(ohbl(), parcial, source, NOW);
    const grounding = report.findings.find((f) => f.kind === 'grounding');
    expect(grounding?.severity).toBe('error');
    expect(grounding?.message).toContain('MSKU7654321');
    expect(grounding?.message).not.toContain('MNBU3949421,');
  });

  it('trata a posição do SH de 4 dígitos impressa no BL como aviso, não erro', () => {
    const report = verifyExtraction(ohbl(), data(), source, NOW);
    const ncm = report.findings.find((f) => f.field.startsWith('ncmList'));
    expect(ncm?.severity).toBe('warning');
  });

  it('não aceita código curto que NÃO está impresso no documento', () => {
    const inventado = { ...data(), ncmList: cf(['9503'], 0.9) };
    const report = verifyExtraction(ohbl(), inventado, source, NOW);
    const ncm = report.findings.find((f) => f.field.startsWith('ncmList'));
    expect(ncm?.severity).toBe('error');
  });

  it('na invoice a NCM continua exigindo 8 dígitos', () => {
    const config = getVerificationConfig('invoice') as VerificationConfig;
    const report = verifyExtraction(
      config,
      { items: [{ itemCode: cf('ABC123'), ncmCode: cf('4202') }] },
      'invoice com ABC123 e 4202',
      NOW,
    );
    expect(report.findings.some((f) => f.severity === 'error' && f.field.includes('ncmCode'))).toBe(
      true,
    );
  });

  it('mede o CBM contra a capacidade dos DOIS contêineres do embarque', () => {
    const report = verifyExtraction(ohbl(), data(), source, NOW);
    expect(report.findings.some((f) => f.field === 'totalCbm')).toBe(false);
  });

  it('continua acusando CBM acima da capacidade de UM contêiner', () => {
    const umContainer = { ...data(), containerNumber: cf('MNBU3949421', 0.95) };
    const report = verifyExtraction(ohbl(), umContainer, source, NOW);
    expect(report.findings.some((f) => f.field === 'totalCbm' && f.severity === 'warning')).toBe(
      true,
    );
  });

  it('no conjunto, o OHBL correto do PK220 não vai mais para revisão', () => {
    const report = verifyExtraction(ohbl(), data(), source, NOW);
    expect(report.trust).toBe('trusted');
    expect(report.findings.filter((f) => f.severity === 'error')).toHaveLength(0);
  });
});
