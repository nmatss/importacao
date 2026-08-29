import { describe, it, expect, vi } from 'vitest';
import { createMockDb } from '../../../__tests__/helpers/mock-db.js';

const { mockDb } = createMockDb();
vi.mock('../../../shared/database/connection.js', () => ({ db: mockDb }));
vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

/**
 * A guarda de bomba de descompressao foi instalada em `spreadsheetBufferToText`
 * e no ramo docx. Este arquivo existe porque essa pergunta ficou sem resposta:
 * **`spreadsheetBufferToText` e o unico caminho ate `XLSX.read`?**
 *
 * Nao e. Ha outros dois, e os dois recebem buffer de origem externa:
 *
 * 1. `parseEspelhoBuffer` — chamado por `documentService.processEspelho`, que
 *    roda no worker do pg-boss DENTRO do processo da API. O ramo `espelho` de
 *    `processWithAIClaimed` desvia para o parser deterministico e NUNCA passa
 *    por `spreadsheetBufferToText`. Ou seja: o caminho mais provavel de um xlsx
 *    no sistema — um espelho — era exatamente o que ficou de fora.
 * 2. `parsePreConsXLSX` — `POST /api/pre-cons/sync` (upload de ate 20 MB) e
 *    `POST /api/pre-cons/sync-from-drive`, que baixa da pasta do Shared Drive.
 *    A rota exige admin, mas o CONTEUDO em `sync-from-drive` vem de quem tem
 *    escrita no Drive, que nao e a mesma pessoa.
 *
 * O teste nao verifica so que lanca: verifica que lanca ANTES de `XLSX.read`.
 */
const xlsxSpy = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('xlsx', async (importOriginal) => {
  const original = await importOriginal<typeof import('xlsx')>();
  xlsxSpy.read.mockImplementation((...args: Parameters<typeof original.read>) =>
    original.read(...args),
  );
  return { ...original, read: xlsxSpy.read };
});

const XLSX = await import('xlsx');
const { parseEspelhoBuffer } = await import('../../espelho-parser/parser.js');
const { parsePreConsXLSX } = await import('../../pre-cons/service.js');

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
/** O arquivo medido em 2026-08-29: 4,7 MB que viram 127 MB de XML. */
const bomba = () => zipComIndice(Math.round(4.7 * MB), 127 * MB);

/** Planilha real, para a contraprova de que o parser E chamado no caminho bom. */
function planilhaLegitima(): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ sku: 'ABC-1', qtd: 3 }]), 'Plan1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('parseEspelhoBuffer() — caminho do worker de espelho', () => {
  it('recusa a bomba SEM chamar o parser', () => {
    xlsxSpy.read.mockClear();
    expect(() => parseEspelhoBuffer(bomba())).toThrow(/Arquivo recusado/);
    expect(xlsxSpy.read).not.toHaveBeenCalled();
  });

  it('planilha legitima continua chegando ao parser', () => {
    xlsxSpy.read.mockClear();
    // Sem cabecalho de espelho, o parser recusa por FORMATO — que e outra coisa,
    // e e justamente o que prova que ele rodou.
    expect(() => parseEspelhoBuffer(planilhaLegitima())).toThrow(/aba de espelho/i);
    expect(xlsxSpy.read).toHaveBeenCalledTimes(1);
  });
});

describe('parsePreConsXLSX() — caminho de upload e de Drive do Pre-Cons', () => {
  it('recusa a bomba SEM chamar o parser', () => {
    xlsxSpy.read.mockClear();
    expect(() => parsePreConsXLSX(bomba())).toThrow(/Arquivo recusado/);
    expect(xlsxSpy.read).not.toHaveBeenCalled();
  });

  it('planilha legitima continua chegando ao parser', () => {
    xlsxSpy.read.mockClear();
    const resultado = parsePreConsXLSX(planilhaLegitima());
    expect(resultado.sheets).toBeDefined();
    expect(xlsxSpy.read).toHaveBeenCalledTimes(1);
  });
});
