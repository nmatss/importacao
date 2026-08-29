import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as XLSX from 'xlsx';
import { createMockDb } from '../../../__tests__/helpers/mock-db.js';

const { mockDb } = createMockDb();

vi.mock('../../../shared/database/connection.js', () => ({
  db: mockDb,
}));

vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { extractAttachmentTextForClassification } = await import('../processor.js');

/** Planilha com linhas em branco DENTRO do range usado, como as reais. */
function planilha(rows: Record<string, XLSX.CellObject>, ref: string, sheetName = 'Plan1'): Buffer {
  const sheet: XLSX.WorkSheet = { ...rows, '!ref': ref };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function anexo(content: Buffer) {
  return { filename: 'planilha.xlsx', contentType: 'application/vnd.ms-excel', content };
}

describe('extractAttachmentTextForClassification — planilha', () => {
  const maxCharsOriginal = process.env.DOCUMENT_SPREADSHEET_MAX_CHARS;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (maxCharsOriginal === undefined) delete process.env.DOCUMENT_SPREADSHEET_MAX_CHARS;
    else process.env.DOCUMENT_SPREADSHEET_MAX_CHARS = maxCharsOriginal;
  });

  it('descarta as linhas em branco do range inflado', async () => {
    // A1:B10 com so a linha 1 e a 4 preenchidas — e o que acontece quando
    // alguem formata a coluna inteira. Sem `blankrows: false` e sem o descarte
    // de linha so-separador, isso virava oito linhas de ',' no meio do texto.
    const buffer = planilha(
      {
        A1: { t: 's', v: 'produto' },
        B1: { t: 's', v: 'quantidade' },
        A4: { t: 's', v: 'meia' },
        B4: { t: 's', v: '120' },
      },
      'A1:B10',
    );

    const texto = await extractAttachmentTextForClassification(anexo(buffer));

    expect(texto).toContain('produto,quantidade');
    expect(texto).toContain('meia,120');
    // Nenhuma linha pode ser apenas separadores/espaco.
    const linhasVazias = texto.split('\n').filter((l) => l.replace(/[,;\s]/g, '').length === 0);
    expect(linhasVazias).toEqual([]);
  });

  it('mantem o cabecalho de aba no formato anterior', async () => {
    const buffer = planilha({ A1: { t: 's', v: 'x' } }, 'A1:A1', 'Fatura');
    const texto = await extractAttachmentTextForClassification(anexo(buffer));
    expect(texto).toContain('--- Sheet: Fatura ---');
  });

  it('trunca no teto de caracteres e sinaliza o corte', async () => {
    process.env.DOCUMENT_SPREADSHEET_MAX_CHARS = '50';

    const celulas: Record<string, XLSX.CellObject> = {};
    for (let linha = 1; linha <= 60; linha += 1) {
      celulas[`A${linha}`] = { t: 's', v: `valor-${linha}` };
    }
    const buffer = planilha(celulas, 'A1:A60');

    const texto = await extractAttachmentTextForClassification(anexo(buffer));

    expect(texto).toContain('[TEXTO TRUNCADO');
    // O corte precisa valer de verdade: nao pode devolver a planilha inteira.
    expect(texto.length).toBeLessThan(200);
    expect(texto).not.toContain('valor-60');
  });

  it('nao estoura com buffer que nao e planilha', async () => {
    // XLSX.read nao lanca nesse caso — interpreta o conteudo como texto e
    // devolve uma aba unica. O que importa e a classificacao seguir sem erro.
    await expect(
      extractAttachmentTextForClassification(anexo(Buffer.from('nao e xlsx'))),
    ).resolves.toEqual(expect.any(String));
  });
});
