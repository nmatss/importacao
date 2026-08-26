/**
 * Read-only triage for historical documents classified as `other`.
 *
 * The report contains only identifiers, hashes and classification signals;
 * source text and filenames are never persisted or printed. It deliberately
 * does not mutate classifications: ambiguous/supporting documents require an
 * operator decision before PATCH /api/documents/:id/classification.
 */

import { createHash } from 'node:crypto';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pdfParse from 'pdf-parse';
import * as XLSX from 'xlsx';
import { eq } from 'drizzle-orm';
import { db, pool } from '../shared/database/connection.js';
import { documents, importProcesses } from '../shared/database/schema.js';
import {
  classifyDocument,
  classifyDocumentText,
} from '../modules/email-ingestion/classify-document.js';

type TriageDecision =
  | 'unambiguous_supported_type'
  | 'ambiguous_manual_review'
  | 'justified_other_or_unreadable';

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function extractText(buffer: Buffer, filename: string, mimeType: string | null): string {
  const lower = filename.toLowerCase();
  const mime = (mimeType ?? '').toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || mime.includes('spreadsheet')) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    return workbook.SheetNames.slice(0, 5)
      .map((sheetName) => XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]))
      .join('\n');
  }
  return '';
}

async function extractDocumentText(
  buffer: Buffer,
  filename: string,
  mimeType: string | null,
): Promise<string> {
  const lower = filename.toLowerCase();
  const mime = (mimeType ?? '').toLowerCase();
  if (lower.endsWith('.pdf') || mime.includes('pdf')) {
    return (await pdfParse(buffer)).text ?? '';
  }
  return extractText(buffer, filename, mimeType);
}

function decide(filenameType: string, contentTypes: string[]) {
  const candidates = [
    ...new Set([...(filenameType === 'other' ? [] : [filenameType]), ...contentTypes]),
  ].sort();
  let decision: TriageDecision = 'justified_other_or_unreadable';
  let suggestedType: string | null = null;
  if (candidates.length === 1) {
    decision = 'unambiguous_supported_type';
    suggestedType = candidates[0];
  } else if (candidates.length > 1) {
    decision = 'ambiguous_manual_review';
  }
  return { candidates, decision, suggestedType };
}

async function main() {
  const outIndex = process.argv.findIndex((arg) => arg === '--out');
  const outEquals = process.argv.find((arg) => arg.startsWith('--out='));
  const outPath =
    outEquals?.slice('--out='.length) ??
    (outIndex >= 0 ? process.argv[outIndex + 1] : undefined) ??
    `/tmp/other-triage-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

  const rows = await db
    .select({
      documentId: documents.id,
      processId: documents.processId,
      processCode: importProcesses.processCode,
      originalFilename: documents.originalFilename,
      storagePath: documents.storagePath,
      mimeType: documents.mimeType,
    })
    .from(documents)
    .innerJoin(importProcesses, eq(importProcesses.id, documents.processId))
    .where(eq(documents.type, 'other'));

  const report = [];
  for (const row of rows) {
    const absolutePath = path.isAbsolute(row.storagePath)
      ? row.storagePath
      : path.resolve(row.storagePath);
    try {
      const buffer = await readFile(absolutePath);
      const filenameType = classifyDocument(row.originalFilename);
      const content = await extractDocumentText(buffer, row.originalFilename, row.mimeType);
      const contentTypes = classifyDocumentText(content.slice(0, 10_000));
      report.push({
        documentId: row.documentId,
        processId: row.processId,
        processCode: row.processCode,
        sha256: sha256(buffer),
        filenameType,
        contentTypes,
        textReadable: content.trim().length > 0,
        ...decide(filenameType, contentTypes),
      });
    } catch {
      report.push({
        documentId: row.documentId,
        processId: row.processId,
        processCode: row.processCode,
        sha256: null,
        filenameType: classifyDocument(row.originalFilename),
        contentTypes: [],
        textReadable: false,
        candidates: [],
        decision: 'justified_other_or_unreadable' as TriageDecision,
        suggestedType: null,
        sourceReadFailed: true,
      });
    }
  }

  await writeFile(
    outPath,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), documents: report }, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
  await chmod(outPath, 0o600);

  const counts = report.reduce<Record<string, number>>((acc, row) => {
    acc[row.decision] = (acc[row.decision] ?? 0) + 1;
    return acc;
  }, {});
  console.log(JSON.stringify({ total: report.length, counts, evidence: outPath }));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Falha desconhecida');
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
