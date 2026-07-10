import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  documentOcrDuration,
  documentOcrPagesTotal,
  documentOcrRunsTotal,
} from '../../shared/metrics/index.js';
import { logger } from '../../shared/utils/logger.js';

export type OcrResult = {
  text: string;
  pageTexts: string[];
  pageCount: number;
};

function positiveEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function enabled(): boolean {
  return process.env.DOCUMENT_OCR_ENABLED === '1';
}

function run(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`OCR command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`OCR command exited ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}

/**
 * Optional local OCR for scanned PDFs. It deliberately relies only on the
 * fixed, operator-installed Poppler and Tesseract binaries, is opt-in, has
 * a hard page/time budget, and never prevents the existing multimodal path.
 */
export async function ocrScannedPdf(filePath: string): Promise<OcrResult | null> {
  if (!enabled()) return null;

  const maxPages = Math.floor(positiveEnv('DOCUMENT_OCR_MAX_PAGES', 20));
  const timeoutMs = positiveEnv('DOCUMENT_OCR_TIMEOUT_MS', 60_000);
  const language = process.env.DOCUMENT_OCR_LANGUAGES?.trim() || 'por+eng';
  const renderer = process.env.DOCUMENT_OCR_PDF_RENDERER?.trim() || 'pdftoppm';
  const tesseract = process.env.DOCUMENT_OCR_COMMAND?.trim() || 'tesseract';
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'importacao-ocr-'));
  const prefix = path.join(tempDir, 'page');
  const stopTimer = documentOcrDuration.startTimer();

  try {
    await run(
      renderer,
      ['-png', '-r', '200', '-f', '1', '-l', String(maxPages), filePath, prefix],
      timeoutMs,
    );
    const pages = (await fs.readdir(tempDir))
      .filter((name) => /^page-\d+\.png$/i.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (pages.length === 0) throw new Error('PDF renderer produced no pages');

    const pageTexts: string[] = [];
    for (const page of pages) {
      pageTexts.push(
        (
          await run(tesseract, [path.join(tempDir, page), 'stdout', '-l', language], timeoutMs)
        ).trim(),
      );
    }
    const text = pageTexts.filter(Boolean).join('\n\f\n');
    documentOcrRunsTotal.inc({ outcome: text ? 'success' : 'empty' });
    documentOcrPagesTotal.inc(pages.length);
    return { text, pageTexts, pageCount: pages.length };
  } catch (error) {
    documentOcrRunsTotal.inc({ outcome: 'failed' });
    logger.warn(
      { err: error, filePath },
      'Local OCR unavailable or failed; preserving multimodal fallback',
    );
    return null;
  } finally {
    stopTimer();
    await fs
      .rm(tempDir, { recursive: true, force: true })
      .catch((error) =>
        logger.warn({ err: error, tempDir }, 'Failed to remove OCR temporary directory'),
      );
  }
}
