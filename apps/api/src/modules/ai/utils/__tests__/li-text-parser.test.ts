import { describe, expect, it } from 'vitest';
import { tryParseLIText } from '../li-text-parser.js';

describe('LI text parser', () => {
  it('extracts a sanitized LI fixture without calling the LLM', () => {
    const parsed = tryParseLIText(`LICENCA DE IMPORTACAO
LI: 26/1234567-0
Data Registro: 2026-05-20
Importador: EMPRESA TESTE S/A CNPJ 11.222.333/0001-81
Exportador: SANITIZED EXPORTER LTD
NCM: 6115.95.00
Descricao: PRODUTO SANITIZADO PARA TESTE
Quantidade: 120 UN
Valor FOB: USD 1020.00
Processo: TESTE-SANITIZADO`);

    expect(parsed?.liNumber.value).toBe('26/1234567-0');
    expect(parsed?.registrationDate.value).toBe('2026-05-20');
    expect(parsed?.importerName.value).toBe('EMPRESA TESTE S/A');
    expect(parsed?.importerCnpj.value).toBe('11.222.333/0001-81');
    expect(parsed?.exporterName.value).toBe('SANITIZED EXPORTER LTD');
    expect(parsed?.totalValue.value).toBe(1020);
    expect(parsed?.currency.value).toBe('USD');
    expect(parsed?.items[0].ncmCode.value).toBe('6115.95.00');
    expect(parsed?.items[0].quantity.value).toBe(120);
  });
});
