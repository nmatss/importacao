import { describe, it, expect, afterEach } from 'vitest';
import * as XLSX from 'xlsx';
import {
  assertArquivoSeguroParaAbrir,
  inspecionarArquivoCompactado,
  MAX_DESCOMPRIMIDO_PADRAO,
} from '../archive-guard.js';

/**
 * Monta um ZIP com apenas o indice (central directory + EOCD). Basta para esta
 * guarda, que decide pelo indice e nunca descomprime — e permite declarar
 * "127 MB descomprimidos" sem alocar 127 MB no teste.
 */
function zipComIndice(
  entradas: Array<{ comprimido: number; descomprimido: number; nome?: string }>,
): Buffer {
  const registros = entradas.map(({ comprimido, descomprimido, nome = 'sheet1.xml' }) => {
    const bytesNome = Buffer.from(nome, 'utf8');
    const cabecalho = Buffer.alloc(46);
    cabecalho.writeUInt32LE(0x02014b50, 0);
    cabecalho.writeUInt32LE(comprimido >>> 0, 20);
    cabecalho.writeUInt32LE(descomprimido >>> 0, 24);
    cabecalho.writeUInt16LE(bytesNome.length, 28);
    return Buffer.concat([cabecalho, bytesNome]);
  });

  const centralDirectory = Buffer.concat(registros);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(registros.length, 8);
  eocd.writeUInt16LE(registros.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(0, 16); // o indice comeca no offset 0 deste buffer
  return Buffer.concat([centralDirectory, eocd]);
}

const MB = 1024 * 1024;
const envAntes = { ...process.env };

afterEach(() => {
  process.env.DOCUMENT_ARCHIVE_MAX_UNCOMPRESSED_BYTES =
    envAntes.DOCUMENT_ARCHIVE_MAX_UNCOMPRESSED_BYTES;
  process.env.DOCUMENT_ARCHIVE_MAX_RATIO = envAntes.DOCUMENT_ARCHIVE_MAX_RATIO;
  if (envAntes.DOCUMENT_ARCHIVE_MAX_UNCOMPRESSED_BYTES === undefined)
    delete process.env.DOCUMENT_ARCHIVE_MAX_UNCOMPRESSED_BYTES;
  if (envAntes.DOCUMENT_ARCHIVE_MAX_RATIO === undefined)
    delete process.env.DOCUMENT_ARCHIVE_MAX_RATIO;
});

describe('inspecionarArquivoCompactado()', () => {
  it('soma os tamanhos declarados no indice, sem descomprimir', () => {
    const r = inspecionarArquivoCompactado(
      zipComIndice([
        { comprimido: 1 * MB, descomprimido: 10 * MB, nome: 'xl/worksheets/sheet1.xml' },
        { comprimido: 1 * MB, descomprimido: 30 * MB, nome: 'xl/sharedStrings.xml' },
      ]),
    );
    expect(r).toMatchObject({
      entradas: 2,
      bytesComprimidos: 2 * MB,
      bytesDescomprimidos: 40 * MB,
    });
    expect(r?.razao).toBe(20);
  });

  it('devolve nulo para buffer que nao e ZIP', () => {
    expect(inspecionarArquivoCompactado(Buffer.from('%PDF-1.7 nada de zip aqui'))).toBeNull();
    expect(inspecionarArquivoCompactado(Buffer.alloc(0))).toBeNull();
  });
});

describe('assertArquivoSeguroParaAbrir()', () => {
  /**
   * Este e o caso medido em 2026-08-29: xlsx valido de 4,7 MB com 3 colunas x
   * 400 mil linhas descomprime para 127 MB de XML e leva o RSS a 770 MB no
   * `XLSX.read`. O container tem 512 M e os workers rodam dentro do processo da
   * API, entao o alvo do OOM e a API inteira.
   */
  it('recusa o arquivo medido em producao: 4,7 MB comprimidos, 127 MB descomprimidos', () => {
    const bomba = zipComIndice([{ comprimido: Math.round(4.7 * MB), descomprimido: 127 * MB }]);
    expect(() => assertArquivoSeguroParaAbrir(bomba)).toThrowError(/127\.0 MB.*acima do limite/);
  });

  it('o erro sai como 413, nao como 500', () => {
    try {
      assertArquivoSeguroParaAbrir(zipComIndice([{ comprimido: MB, descomprimido: 500 * MB }]));
      throw new Error('deveria ter lancado');
    } catch (err) {
      expect((err as { statusCode?: number }).statusCode).toBe(413);
      expect((err as { code?: string }).code).toBe('ARCHIVE_TOO_LARGE');
    }
  });

  it('recusa razao de expansao absurda mesmo com total pequeno', () => {
    // 2 KB -> 8 MB: fica MUITO abaixo do teto absoluto, e ainda assim e bomba.
    expect(() =>
      assertArquivoSeguroParaAbrir(zipComIndice([{ comprimido: 2048, descomprimido: 8 * MB }])),
    ).toThrowError(/expande .*x ao descomprimir/);
  });

  it('recusa ZIP64, que esconde o tamanho real fora do campo de 4 bytes', () => {
    expect(() =>
      assertArquivoSeguroParaAbrir(
        zipComIndice([{ comprimido: 0xffffffff, descomprimido: 0xffffffff }]),
      ),
    ).toThrowError(/ZIP64/);
  });

  it('ACEITA planilha operacional de verdade', () => {
    const wb = XLSX.utils.book_new();
    const linhas = Array.from({ length: 500 }, (_, i) => ({
      sku: `SKU-${i}`,
      qtd: i,
      valor: i * 1.5,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), 'Espelho');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    expect(() => assertArquivoSeguroParaAbrir(buffer)).not.toThrow();
  });

  it('buffer que nao e ZIP passa: quem chama ja validou o tipo', () => {
    expect(() => assertArquivoSeguroParaAbrir(Buffer.from('texto solto'))).not.toThrow();
  });

  /**
   * `Number(undefined)` e NaN, e NaN nao ativa o `??`. Escrita com `??` direto,
   * a leitura do ambiente faria o limite virar NaN quando a variavel nao existe,
   * toda comparacao daria falso e a guarda ficaria DESLIGADA em silencio.
   */
  it('variavel de ambiente ausente ou invalida cai no padrao, e nao em NaN', () => {
    const acimaDoPadrao = zipComIndice([
      { comprimido: 10 * MB, descomprimido: MAX_DESCOMPRIMIDO_PADRAO + MB },
    ]);

    delete process.env.DOCUMENT_ARCHIVE_MAX_UNCOMPRESSED_BYTES;
    expect(() => assertArquivoSeguroParaAbrir(acimaDoPadrao)).toThrow();

    process.env.DOCUMENT_ARCHIVE_MAX_UNCOMPRESSED_BYTES = 'nao-e-numero';
    expect(() => assertArquivoSeguroParaAbrir(acimaDoPadrao)).toThrow();

    process.env.DOCUMENT_ARCHIVE_MAX_UNCOMPRESSED_BYTES = '';
    expect(() => assertArquivoSeguroParaAbrir(acimaDoPadrao)).toThrow();
  });

  it('respeita um teto configurado explicitamente', () => {
    process.env.DOCUMENT_ARCHIVE_MAX_UNCOMPRESSED_BYTES = String(300 * MB);
    expect(() =>
      assertArquivoSeguroParaAbrir(
        zipComIndice([{ comprimido: 50 * MB, descomprimido: 127 * MB }]),
      ),
    ).not.toThrow();
  });
});
