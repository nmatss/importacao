import { beforeEach, describe, expect, it, vi } from 'vitest';
const execFile = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile }));
const { extractPopplerText } = await import('../pdf-text.js');
const page = 'BL ORIGINAL container ABCD1234567 shipment weights packages '.repeat(8);

describe('Poppler digital PDF text', () => {
  beforeEach(() => {
    execFile.mockReset();
  });
  it('preserves layout/page boundaries and bounds subprocess without shell interpolation', async () => {
    execFile.mockImplementation((_command, _args, _opts, callback) =>
      callback(null, `${page}\f${page}\f`, ''),
    );
    const result = await extractPopplerText('/tmp/input $(secret).pdf');
    expect(result?.pageTexts).toEqual([page.trim(), page.trim()]);
    expect(execFile).toHaveBeenCalledWith(
      'pdftotext',
      ['-layout', '-enc', 'UTF-8', '/tmp/input $(secret).pdf', '-'],
      expect.objectContaining({ timeout: 15_000, maxBuffer: 4194304 }),
      expect.any(Function),
    );
  });
  it('keeps visual fallback when Poppler lacks the CID mapping despite form text', async () => {
    execFile.mockImplementation((_command, _args, _opts, callback) =>
      callback(null, page, 'Missing language pack for Adobe-GB1 mapping'),
    );
    expect(await extractPopplerText('/tmp/input.pdf')).toBeNull();
  });
  it('normalizes fullwidth CID text without dropping SKU zeros or merging columns', async () => {
    const original = `${page}\nＰＫ２２０２６０８ＳＺ    ０５０４０４５０９\n４２ ＣＡＲＴＯＮＳ  ３９９．０００ ＫＧＳ  １．４３２ ＣＢＭ\f`;
    execFile.mockImplementation((_command, _args, _opts, callback) => callback(null, original, ''));
    const result = await extractPopplerText('/tmp/input.pdf');
    expect(result?.text).toContain('PK2202608SZ    050404509');
    expect(result?.text).toContain('42 CARTONS  399.000 KGS  1.432 CBM');
    expect(result?.pageTexts).toEqual([result?.text]);
  });
  it.each(['', 'BILL OF LADING', `${page}\fSCANNED PAGE\f`])(
    'delegates empty or partially unreadable PDFs',
    async (text) => {
      execFile.mockImplementation((_command, _args, _opts, callback) => callback(null, text, ''));
      expect(await extractPopplerText('/tmp/input.pdf')).toBeNull();
    },
  );
  it.each(['ENOENT', 'ETIMEDOUT', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'])(
    'delegates bounded command failure %s',
    async (code) => {
      execFile.mockImplementation((_command, _args, _opts, callback) =>
        callback(Object.assign(new Error('failure'), { code })),
      );
      expect(await extractPopplerText('/tmp/input.pdf')).toBeNull();
    },
  );
});
