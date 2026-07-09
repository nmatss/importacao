import { describe, expect, it } from 'vitest';
import { fillDUIMPNullsFromText, tryParseDUIMPText } from '../duimp-text-parser.js';

const cf = (value: unknown, confidence = 0.9) => ({ value, confidence });

describe('DUIMP text parser', () => {
  const finalDuimp = `DECLARACAO UNICA DE IMPORTACAO - DUIMP
Numero da DUIMP: 26BR0000000001
Data de Registro: 09/07/2026
Valor Aduaneiro: R$ 123.456,78
Dolar de Registro: 5,432100
Valor do Seguro: R$ 1.234,56
Canal RFB: VERDE
Data de Desembaraco: 10/07/2026`;

  it('extracts the seven Registro fields from a text-native final DUIMP', () => {
    const parsed = tryParseDUIMPText(finalDuimp);

    expect(parsed?.duimpNumber.value).toBe('26BR0000000001');
    expect(parsed?.registeredAt.value).toBe('2026-07-09');
    expect(parsed?.customsValue.value).toBe(123456.78);
    expect(parsed?.registrationDollar.value).toBe(5.4321);
    expect(parsed?.insuranceValue.value).toBe(1234.56);
    expect(parsed?.customsChannel.value).toBe('Verde');
    expect(parsed?.customsClearanceAt.value).toBe('2026-07-10');
  });

  it('accepts a draft DUIMP while leaving absent final-only fields null', () => {
    const parsed = tryParseDUIMPText(`MINUTA DUIMP
DUIMP Nº: 26BR0000000002
Valor Aduaneiro: 10.000,00
Taxa de Cambio: 5,120000
Seguro: 20,00
Data de Registro: 11/07/2026`);

    expect(parsed?.duimpNumber.value).toBe('26BR0000000002');
    expect(parsed?.customsChannel.value).toBeNull();
    expect(parsed?.customsClearanceAt.value).toBeNull();
  });

  it('does not parse an arbitrary document as DUIMP', () => {
    expect(tryParseDUIMPText('COMMERCIAL INVOICE\nValor Aduaneiro: 100,00')).toBeNull();
  });

  it('backfills only null model fields from labelled source text', () => {
    const data = {
      customsValue: cf(999, 0.95),
      registrationDollar: cf(null, 0),
      insuranceValue: cf(null, 0),
      duimpNumber: cf(null, 0),
      registeredAt: cf(null, 0),
      customsClearanceAt: cf(null, 0),
      customsChannel: cf(null, 0),
    };

    const filled = fillDUIMPNullsFromText(data, finalDuimp);

    expect(filled.customsValue.value).toBe(999);
    expect(filled.registrationDollar.value).toBe(5.4321);
    expect(filled.duimpNumber.value).toBe('26BR0000000001');
    expect(filled.customsChannel.value).toBe('Verde');
  });
});
