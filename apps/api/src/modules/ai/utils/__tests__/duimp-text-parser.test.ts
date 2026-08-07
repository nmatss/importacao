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

  // Layout copied from the real "Extrato-DUIMP-26BR00003506429-Versao-0001 -
  // PK2052602TJ.pdf" as pdf-parse renders it: the page-1 summary is free text
  // with two currencies per line, the rate is an equation, and the only
  // registration date lives in the Histórico table.
  const portalUnicoExtract = `Extrato da Duimp 26BR0000350642-9 / Versão 0001
Situação da Duimp:
Registrada. Aguardando Resultado da Análise de Risco
=================================================================
TAXA DE CAMBIO: US$ 1,00 = R$ 5,1606
TAXA DE UTILIZACAO DO SISCOMEX: R$ 254,49
=================================================================
DE ACORDO COM O DECRETO Nº 11.090 ... SERÃO EXCLUÍDOS DA BASE DE
CÁLCULO DOS IMPOSTOS (VALOR ADUANEIRO) OS GASTOS RELATIVOS À CARGA
=================================================================
VALOR FOB:  US$ 171.298,77 / R$ 884.004,44
FRETE:  US$ 3.149,99 / R$  16.255,84
SEGURO: US$ 117,06 / R$  603,84
=================================================================
VALOR ADUANEIRO - R$ 900.864,17
Histórico
Data/HoraEventoResponsávelÓrgãoInformações Adicionais
02/04/2026,
17:10
Declaração registrada889.712.449-68Duimp registrada via Aplicação Web.`;

  it('reads the two-currency summary of a Portal Unico extract', () => {
    const parsed = tryParseDUIMPText(portalUnicoExtract);

    expect(parsed?.duimpNumber.value).toBe('26BR0000350642-9');
    // BRL side of the summary, and NOT the "(VALOR ADUANEIRO)" boilerplate.
    expect(parsed?.customsValue.value).toBe(900864.17);
    // Right-hand side of "US$ 1,00 = R$ 5,1606", never the 1,00.
    expect(parsed?.registrationDollar.value).toBe(5.1606);
    // Seguro is stored in USD by the process.
    expect(parsed?.insuranceValue.value).toBe(117.06);
    expect(parsed?.registeredAt.value).toBe('2026-04-02');
    // Still awaiting risk analysis: neither channel nor clearance is printed.
    expect(parsed?.customsChannel.value).toBeNull();
    expect(parsed?.customsClearanceAt.value).toBeNull();
  });

  it('reads the Fenicia rascunho rate label and leaves the unregistered fields null', () => {
    // "RASCUNHO  DUIMP PUK016-26 - PK2052602TJ.pdf": no DUIMP number, no valor
    // aduaneiro, and the rate is labelled "Taxa Dólar" instead of "Taxa de
    // Câmbio". Glued labels are how pdf-parse renders the Fenicia grid.
    const rascunho = `FENICIA ASSESSORIA EM COMERCIO EXTERIOR LTDA
Cód. DUIMP : [268]
Número da DUIMP:Data de Registro:
Situação da DUIMP:EM CADASTRO
NÃO REGISTRADA
Canal:SEM PARAMETRIZAÇÃO
Valor do Seguro:0
Taxa Seguro:5,2275Taxa Dólar:5,2275
FOB (Dólar):171.298,78`;

    const filled = fillDUIMPNullsFromText(
      {
        customsValue: cf(null, 0),
        registrationDollar: cf(null, 0),
        insuranceValue: cf(null, 0),
        duimpNumber: cf(null, 0),
        registeredAt: cf(null, 0),
        customsClearanceAt: cf(null, 0),
        customsChannel: cf(null, 0),
      },
      rascunho,
    );

    expect(filled.registrationDollar.value).toBe(5.2275);
    expect(filled.insuranceValue.value).toBe(0);
    expect(filled.customsValue.value).toBeNull();
    expect(filled.duimpNumber.value).toBeNull();
    expect(filled.registeredAt.value).toBeNull();
    // "SEM PARAMETRIZAÇÃO" is not a channel.
    expect(filled.customsChannel.value).toBeNull();
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
