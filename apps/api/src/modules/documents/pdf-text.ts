import { execFile } from 'node:child_process';
import path from 'node:path';

/** Read the digital text layer using installed Poppler CMaps, preserving columns.
 * No OCR/network/provider call. Missing tools, unreadable text and bounded
 * execution failures delegate to the existing PDF/OCR/multimodal pipeline.
 */
export async function extractPopplerText(filePath: string): Promise<{
  text: string;
  pageTexts: string[];
} | null> {
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        'pdftotext',
        ['-layout', '-enc', 'UTF-8', path.resolve(filePath), '-'],
        { timeout: 15_000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8', windowsHide: true },
        (error, output, stderr) => {
          if (error) reject(error);
          else if (
            /missing language pack|unknown character collection|couldn't find.*cmap/i.test(stderr)
          ) {
            reject(new Error('PDF character mapping unavailable'));
          } else resolve(output);
        },
      );
    });
    // CID fonts can expose ASCII letters/digits as fullwidth Unicode. Normalize
    // the extracted representation, keeping the original PDF intact, so exact
    // identifiers and numeric parsers see the same characters as the reader.
    const text = stdout.normalize('NFKC');
    const pages = text.split('\f');
    if (!pages.at(-1)?.trim()) pages.pop();
    if (!pages.length) return null;
    // Do not treat watermark/form residue as a readable document. Every
    // page must qualify; mixed scanned/digital files retain visual fallback.
    if (pages.some((page) => page.replace(/[^\p{L}\p{N}]/gu, '').length < 150)) return null;
    return { text: text.trim(), pageTexts: pages.map((page) => page.trim()) };
  } catch {
    // stderr can include document content; never log it or expose it as an error.
    return null;
  }
}
