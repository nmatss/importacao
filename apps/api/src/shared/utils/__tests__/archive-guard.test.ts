import { describe, it, expect, afterEach } from 'vitest';
import * as XLSX from 'xlsx';
import {
  assertArquivoSeguroParaAbrir,
  inspecionarArquivoCompactado,
  MAX_DESCOMPRIMIDO_PADRAO,
  MAX_DESCOMPRIMIDO_DOCX_PADRAO,
  tetoDescomprimidoDocx,
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

/**
 * O indice do ZIP e um dado do ATACANTE. Estes casos existem porque a primeira
 * versao da guarda acreditava nele: adulterando os campos de tamanho de um xlsx
 * legitimo, a checagem por indice passava com teto de 64 KB e o `XLSX.read`
 * inflava dezenas de MB assim mesmo.
 *
 * O SheetJS, com zlib nativo (o caso no Node), ignora o tamanho declarado e
 * infla o stream inteiro; a comparacao que produz "Bad uncompressed size" so
 * roda DEPOIS de a memoria ja ter sido alocada.
 *
 * Os DOIS metodos precisam de caso proprio: o `XLSX.write` do proprio SheetJS
 * grava ARMAZENADO por padrao, e a primeira tentativa de correcao cobriu so o
 * deflate — o bypass continuou aberto ate o caso armazenado existir aqui.
 */
describe('assertArquivoSeguroParaAbrir() contra indice adulterado', () => {
  function planilhaGorda(comprimir: boolean): Buffer {
    const wb = XLSX.utils.book_new();
    const linhas = Array.from({ length: 8000 }, (_, i) => ({
      a: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      b: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      c: i,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), 'Plan1');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: comprimir }) as Buffer;
  }

  /**
   * Mente no tamanho DESCOMPRIMIDO, no indice e nos cabecalhos locais.
   *
   * So nesse campo, e por uma razao verificada: mentir tambem no tamanho
   * COMPRIMIDO nao produz ataque nenhum. Para entrada armazenada o SheetJS le
   * exatamente `_csz` bytes, entao encolher esse campo encolhe o que ele
   * carrega — o arquivo quebra por formato em vez de estourar memoria. Para
   * deflate o campo e ignorado, porque o zlib nativo consome o stream ate o
   * fim. O campo que engana e o descomprimido, e e ele que a guarda deixava
   * passar.
   */
  function mentirNosTamanhos(entrada: Buffer): Buffer {
    const b = Buffer.from(entrada);
    for (let i = 0; i + 30 <= b.length; i += 1) {
      const sig = b.readUInt32LE(i);
      if (sig === 0x02014b50) b.writeUInt32LE(1000, i + 24);
      else if (sig === 0x04034b50) b.writeUInt32LE(1000, i + 22);
    }
    return b;
  }

  it.each([
    ['ARMAZENADO', false],
    ['DEFLATE', true],
  ])('recusa ZIP %s cujo indice declara tamanho pequeno e mente', (_metodo, comprimir) => {
    const forjado = mentirNosTamanhos(planilhaGorda(comprimir as boolean));

    // A checagem por declaracao ACEITA: e esse justamente o ponto.
    const declarado = inspecionarArquivoCompactado(forjado)!;
    expect(declarado.bytesDescomprimidos).toBeLessThan(64 * 1024);

    process.env.DOCUMENT_ARCHIVE_MAX_UNCOMPRESSED_BYTES = String(64 * 1024);
    delete process.env.DOCUMENT_ARCHIVE_MAX_RATIO;
    expect(() => assertArquivoSeguroParaAbrir(forjado)).toThrowError(/de verdade passa do limite/);
  });

  /**
   * A primeira versao desta verificacao ABANDONAVA o arquivo inteiro ao topar
   * com um stream corrompido — `return`, nao `continue`. Bastava por uma
   * entrada quebrada ANTES da bomba para desligar a checagem do resto.
   * Encontrado revisando a propria correcao, depois de ela ja estar verde.
   */
  it('entrada corrompida no comeco nao desliga a checagem do resto', () => {
    // Precisa das DUAS coisas: o indice adulterado (senao a checagem por
    // declaracao recusa antes e o teste nao exercita a verificacao real) e a
    // entrada quebrada logo no inicio.
    const b = mentirNosTamanhos(planilhaGorda(true));
    // Corrompe os bytes de dados da PRIMEIRA entrada local, preservando o
    // cabecalho — o indice segue intacto e as entradas seguintes tambem.
    const primeira = b.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    const nome = b.readUInt16LE(primeira + 26);
    const extra = b.readUInt16LE(primeira + 28);
    const dados = primeira + 30 + nome + extra;
    b.fill(0xff, dados, dados + 64);

    process.env.DOCUMENT_ARCHIVE_MAX_UNCOMPRESSED_BYTES = String(64 * 1024);
    delete process.env.DOCUMENT_ARCHIVE_MAX_RATIO;
    expect(() => assertArquivoSeguroParaAbrir(b)).toThrowError(/de verdade passa do limite/);
  });

  it('planilha honesta do mesmo tamanho continua passando', () => {
    process.env.DOCUMENT_ARCHIVE_MAX_UNCOMPRESSED_BYTES = String(64 * MB);
    delete process.env.DOCUMENT_ARCHIVE_MAX_RATIO;
    expect(() => assertArquivoSeguroParaAbrir(planilhaGorda(true))).not.toThrow();
    expect(() => assertArquivoSeguroParaAbrir(planilhaGorda(false))).not.toThrow();
  });
});

/**
 * O teto do docx e MENOR que o do xlsx, e isso e resultado de medicao, nao de
 * simetria. Medido em 2026-08-29 com `mammoth.extractRawText`: 7,9 MB
 * descomprimidos custam 266 MB de RSS (33,7x), 31,6 MB custam 563 MB (17,8x) e
 * 94,9 MB custam 1400 MB (14,8x) — contra ~3,3x do SheetJS.
 *
 * A consequencia pratica: um docx de 580 KB estourava o container de 512M
 * passando FOLGADO no teto de 64 MB herdado do xlsx.
 */
describe('teto de docx', () => {
  const envAntesDocx = process.env.DOCUMENT_ARCHIVE_MAX_UNCOMPRESSED_DOCX_BYTES;
  afterEach(() => {
    if (envAntesDocx === undefined) delete process.env.DOCUMENT_ARCHIVE_MAX_UNCOMPRESSED_DOCX_BYTES;
    else process.env.DOCUMENT_ARCHIVE_MAX_UNCOMPRESSED_DOCX_BYTES = envAntesDocx;
  });

  it('e estritamente menor que o do xlsx', () => {
    expect(MAX_DESCOMPRIMIDO_DOCX_PADRAO).toBeLessThan(MAX_DESCOMPRIMIDO_PADRAO);
  });

  it('recusa o caso medido de 31,6 MB, que o teto do xlsx aceitava', () => {
    const trintaEUmMeio = zipComIndice([{ comprimido: 600 * 1024, descomprimido: 31.6 * MB }]);

    // Com o teto do xlsx isso PASSA — e era esse o defeito.
    expect(() =>
      assertArquivoSeguroParaAbrir(trintaEUmMeio, {
        maxDescomprimido: MAX_DESCOMPRIMIDO_PADRAO,
        maxRazao: 1000,
      }),
    ).not.toThrow();

    expect(() =>
      assertArquivoSeguroParaAbrir(trintaEUmMeio, {
        maxDescomprimido: tetoDescomprimidoDocx(),
        maxRazao: 1000,
      }),
    ).toThrowError(/acima do limite/);
  });

  it('o teto do docx tambem tem valvula de escape pelo ambiente', () => {
    process.env.DOCUMENT_ARCHIVE_MAX_UNCOMPRESSED_DOCX_BYTES = String(100 * MB);
    expect(tetoDescomprimidoDocx()).toBe(100 * MB);

    process.env.DOCUMENT_ARCHIVE_MAX_UNCOMPRESSED_DOCX_BYTES = '';
    expect(tetoDescomprimidoDocx()).toBe(MAX_DESCOMPRIMIDO_DOCX_PADRAO);
  });
});
