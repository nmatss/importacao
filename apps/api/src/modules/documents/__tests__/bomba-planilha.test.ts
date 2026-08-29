import { describe, it, expect, vi } from 'vitest';
import { createMockDb } from '../../../__tests__/helpers/mock-db.js';

const { mockDb } = createMockDb();
vi.mock('../../../shared/database/connection.js', () => ({ db: mockDb }));
vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// `read` precisa ser dublavel para provar que NAO foi chamado; export de ESM
// nao aceita `vi.spyOn`, entao o modulo inteiro e reexportado com esse unico
// membro trocado por um espiao que delega no original.
const xlsxSpy = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('xlsx', async (importOriginal) => {
  const original = await importOriginal<typeof import('xlsx')>();
  xlsxSpy.read.mockImplementation((...args: Parameters<typeof original.read>) =>
    original.read(...args),
  );
  return { ...original, read: xlsxSpy.read };
});

const XLSX = await import('xlsx');
const { spreadsheetBufferToText } = await import('../service.js');

/** ZIP so com indice — declara o tamanho sem alocar os bytes. */
function zipComIndice(comprimido: number, descomprimido: number): Buffer {
  const nome = Buffer.from('xl/worksheets/sheet1.xml', 'utf8');
  const cabecalho = Buffer.alloc(46);
  cabecalho.writeUInt32LE(0x02014b50, 0);
  cabecalho.writeUInt32LE(comprimido >>> 0, 20);
  cabecalho.writeUInt32LE(descomprimido >>> 0, 24);
  cabecalho.writeUInt16LE(nome.length, 28);
  const cd = Buffer.concat([cabecalho, nome]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(0, 16);
  return Buffer.concat([cd, eocd]);
}

const MB = 1024 * 1024;

describe('spreadsheetBufferToText() contra bomba de descompressao', () => {
  /**
   * O ponto do teste nao e so que lanca — e que lanca ANTES de `XLSX.read`.
   * O teto de `maxChars` que ja existia so age depois do parse, entao nao
   * protege memoria nenhuma: no arquivo medido, o RSS ja tinha ido a 770 MB
   * quando `maxChars` teria alguma chance de opinar.
   */
  it('recusa SEM chamar o parser', () => {
    xlsxSpy.read.mockClear();

    expect(() => spreadsheetBufferToText(zipComIndice(Math.round(4.7 * MB), 127 * MB))).toThrow(
      /Arquivo recusado/,
    );
    expect(xlsxSpy.read).not.toHaveBeenCalled();
  });

  it('planilha operacional continua sendo convertida normalmente', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([{ sku: 'ABC-1', qtd: 3 }]),
      'Espelho',
    );
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    xlsxSpy.read.mockClear();
    const texto = spreadsheetBufferToText(buffer);

    expect(texto).toContain('ABC-1');
    // E a contraprova: no caminho legitimo o parser É chamado, entao o caso
    // acima nao esta passando por acidente de mock.
    expect(xlsxSpy.read).toHaveBeenCalledTimes(1);
  });
});
