/**
 * EXT-01 — verificação OFFLINE contra os arquivos REAIS dos BLs 155/156/165/
 * 166/169 (reunião 11/09/2026).
 *
 * Os PDFs são documentos de fornecedor/cliente e NÃO entram no repositório.
 * Para rodar, copie-os de produção para uma pasta local e aponte a variável:
 *
 *   EXT01_PDF_FIXTURES_DIR=/caminho/com/doc155.pdf,doc156.pdf,... \
 *     npx vitest run src/modules/documents/__tests__/extract-text-bl-real-pdf.test.ts
 *
 * Sem a variável o bloco é pulado — a suíte de CI continua verde e nenhum
 * documento real precisa existir. O que ele prova, e que foi verificado em
 * 11/09/2026 com os cinco arquivos:
 *   1. `pdf-parse` (o extrator do servidor) devolve ZERO caractere;
 *   2. o PDF TEM camada de texto — operadores Tj com fonte composta
 *      Type0/CIDFontType0, ordering Adobe-GB1, encoding GBK-EUC-H e SEM
 *      /ToUnicode. É por isso que a analista consegue selecionar o texto no
 *      visualizador e o servidor não consegue lê-lo.
 * Conclusão: não adianta "melhorar o prompt"; o arquivo original precisa ir
 * para o provider que lê PDF (Vertex), que é o que extractText passa a fazer.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const fixturesDir = process.env.EXT01_PDF_FIXTURES_DIR;
const FILES = ['doc155.pdf', 'doc156.pdf', 'doc165.pdf', 'doc166.pdf'];

function inflatedContentStreams(buffer: Buffer): string[] {
  const raw = buffer.toString('latin1');
  const streams: string[] = [];
  let cursor = 0;
  for (;;) {
    const start = raw.indexOf('stream', cursor);
    if (start < 0) break;
    let begin = start + 'stream'.length;
    if (raw[begin] === '\r') begin += 1;
    if (raw[begin] === '\n') begin += 1;
    const end = raw.indexOf('endstream', begin);
    if (end < 0) break;
    cursor = end + 'endstream'.length;
    try {
      streams.push(
        zlib.inflateSync(Buffer.from(raw.slice(begin, end), 'latin1')).toString('latin1'),
      );
    } catch {
      /* stream não-Flate (imagem crua): irrelevante aqui */
    }
  }
  return streams;
}

describe.skipIf(!fixturesDir)('EXT-01 — BLs reais sem camada de texto legível', () => {
  const require = createRequire(import.meta.url);
  const pdfParse = require('pdf-parse') as (data: Buffer) => Promise<{ text: string }>;

  for (const file of FILES) {
    it(`${file}: pdf-parse devolve zero caractere, mas o PDF tem camada de texto CID`, async () => {
      const buffer = fs.readFileSync(path.join(fixturesDir!, file));

      const parsed = await pdfParse(buffer);
      const alnum = (parsed.text ?? '').replace(/[^\p{L}\p{N}]/gu, '');
      expect(alnum).toHaveLength(0);

      const header = buffer.toString('latin1');
      expect(header).toMatch(/\/Subtype\s*\/Type0/);
      expect(header).toMatch(/\/Ordering\s*\(GB1\)/);
      expect(header).not.toMatch(/\/ToUnicode/);

      const textOps = inflatedContentStreams(buffer)
        .join('\n')
        .match(/<[0-9A-Fa-f]+>\s*(?:Tj|')/g);
      expect(textOps?.length ?? 0).toBeGreaterThan(0);
    });
  }
});
