import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { and, eq, isNotNull, inArray } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import { documents, espelhos, importProcesses } from '../../shared/database/schema.js';
import { googleDriveService } from '../integrations/google-drive.service.js';
import { classifyDocument } from '../email-ingestion/classify-document.js';
import { UPLOAD_DIR } from '../../shared/config/paths.js';
import { logger } from '../../shared/utils/logger.js';
import { documentService } from './service.js';

/**
 * Ingest the documents a process has in ITS OWN Drive folder.
 *
 * Pedido da Eduarda (17/08/2026): "eu ficaria mais segura se agora no inicio
 * considerasse so o que incluimos na pasta do processo no drive mesmo". Ate
 * aqui os documentos entravam pelo e-mail e o Drive era so backup
 * (ODETT-STATUS item 6); isto inverte a fonte sem apagar a antiga.
 *
 * DOCUMENT_SOURCE decide quem alimenta os processos:
 *   email (default) — comportamento atual, este job nao roda
 *   drive           — so a pasta do processo no Drive
 *   both            — as duas fontes
 */

export type DocumentSource = 'email' | 'drive' | 'both';

export function getDocumentSource(): DocumentSource {
  const raw = (process.env.DOCUMENT_SOURCE || 'email').toLowerCase();
  return raw === 'drive' || raw === 'both' ? raw : 'email';
}

export function isDriveIngestionEnabled(): boolean {
  const source = getDocumentSource();
  return source === 'drive' || source === 'both';
}

export function isEmailIngestionEnabled(): boolean {
  const source = getDocumentSource();
  return source === 'email' || source === 'both';
}

const DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024;

const SUPPORTED_EXTENSIONS = new Set([
  '.pdf',
  '.xlsx',
  '.xls',
  '.csv',
  '.docx',
  '.doc',
  '.png',
  '.jpg',
  '.jpeg',
]);

function maxFileBytes(): number {
  const raw = Number(process.env.DRIVE_INGESTION_MAX_FILE_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_FILE_BYTES;
}

export interface DriveIngestionResult {
  processId: number;
  processCode: string;
  imported: number;
  skipped: number;
  failed: number;
  /** Reason the process was not processed at all, when applicable. */
  skippedReason?: string;
}

function isSupportedFile(name: string, mimeType: string | null | undefined): boolean {
  if (mimeType === 'application/vnd.google-apps.folder') return false;
  // Google-native files (Docs/Sheets) need an export, not a download; the team
  // drops real Office/PDF files in the process folder, so skip them loudly
  // rather than downloading an error page.
  if (mimeType?.startsWith('application/vnd.google-apps')) return false;
  return SUPPORTED_EXTENSIONS.has(path.extname(name).toLowerCase());
}

/**
 * Ingest one process. Returns counts; never throws for a single bad file so a
 * batch cannot be aborted by one unreadable document.
 */
export async function ingestProcessFromDrive(process: {
  id: number;
  processCode: string;
  brand: string;
  driveFolderId: string | null;
}): Promise<DriveIngestionResult> {
  const result: DriveIngestionResult = {
    processId: process.id,
    processCode: process.processCode,
    imported: 0,
    skipped: 0,
    failed: 0,
  };

  const folderId =
    process.driveFolderId ??
    (await googleDriveService.findProcessFolder(process.processCode, process.brand));

  if (!folderId) {
    result.skippedReason = 'process has no Drive folder';
    return result;
  }

  const files = await googleDriveService.listProcessFiles(folderId);

  // Dedupe against what this process already has. Keyed on driveFileId, so a
  // second run is a no-op instead of duplicating every document.
  const candidateIds = files.map((f) => f.id).filter((id): id is string => Boolean(id));
  const known = new Set<string>();
  if (candidateIds.length > 0) {
    const rows = await db
      .select({ driveFileId: documents.driveFileId })
      .from(documents)
      .where(
        and(eq(documents.processId, process.id), inArray(documents.driveFileId, candidateIds)),
      );
    for (const row of rows) {
      if (row.driveFileId) known.add(row.driveFileId);
    }

    // O espelho gerado pelo sistema tambem e enviado para a subpasta "Espelho"
    // desta MESMA pasta, mas o `driveFileId` dele fica em `espelhos`, nao em
    // `documents`. Sem conferir a outra tabela, cada espelho que o sistema
    // publica voltaria como um `documents` novo na varredura seguinte.
    const espelhoRows = await db
      .select({ driveFileId: espelhos.driveFileId })
      .from(espelhos)
      .where(and(eq(espelhos.processId, process.id), inArray(espelhos.driveFileId, candidateIds)));
    for (const row of espelhoRows) {
      if (row.driveFileId) known.add(row.driveFileId);
    }
  }

  for (const file of files) {
    const fileId = file.id;
    const name = file.name ?? '';
    if (!fileId || !name) continue;
    if (known.has(fileId)) {
      result.skipped += 1;
      continue;
    }
    if (!isSupportedFile(name, file.mimeType)) {
      result.skipped += 1;
      continue;
    }
    const size = Number(file.size ?? 0);
    if (size > maxFileBytes()) {
      logger.warn(
        { processCode: process.processCode, name, size },
        'Drive file exceeds the ingestion size limit — skipped',
      );
      result.skipped += 1;
      continue;
    }

    let filePath: string | null = null;
    try {
      const buffer = await googleDriveService.downloadFileBuffer(fileId);
      await fs.mkdir(UPLOAD_DIR, { recursive: true });
      const safeName = `${Date.now()}-${randomUUID()}-${name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      filePath = path.join(UPLOAD_DIR, safeName);
      await fs.writeFile(filePath, buffer);

      // Nome que nao casa nenhuma regra vira `other`, que NAO tem extractor:
      // o documento entra, e marcado como processado com motivo e gera alerta
      // de operador. Importar assim e melhor que pular — um arquivo que a
      // pessoa colocou na pasta de proposito precisa aparecer. Efeito
      // conhecido: a primeira varredura de uma pasta antiga pode abrir varios
      // desses alertas de uma vez.
      const docType = classifyDocument(name);
      const fakeFile = {
        originalname: name,
        path: filePath,
        mimetype: file.mimeType ?? 'application/octet-stream',
        size: buffer.length,
      } as Express.Multer.File;

      await documentService.upload(process.id, docType, fakeFile, null, { driveFileId: fileId });
      result.imported += 1;
      logger.info(
        { processCode: process.processCode, name, docType, fileId },
        'Document ingested from the process Drive folder',
      );
    } catch (err) {
      result.failed += 1;
      if (filePath) await fs.unlink(filePath).catch(() => {});
      logger.error(
        { err, processCode: process.processCode, name, fileId },
        'Failed to ingest document from Drive',
      );
    }
  }

  return result;
}

// A varredura percorre todos os processos sequencialmente e pode passar dos 10
// minutos do cron. Sem esta trava, duas passadas concorreriam entre o SELECT de
// dedupe e o INSERT, e o mesmo arquivo do Drive entraria duas vezes — o
// `driveFileId` so protege depois de gravado. Mesmo padrao do `email-check`.
let sweepRunning = false;

/** Test seam — a trava e estado de modulo e vaza entre casos sem isto. */
export function __resetDriveSweepLock(): void {
  sweepRunning = false;
}

/**
 * Sweep every process that has a Drive folder. Intended for the scheduler.
 */
export async function ingestAllProcessesFromDrive(): Promise<DriveIngestionResult[]> {
  if (!isDriveIngestionEnabled()) {
    logger.debug('Drive ingestion disabled (DOCUMENT_SOURCE)');
    return [];
  }
  if (sweepRunning) {
    logger.info('Drive ingestion sweep already running — skipping this tick');
    return [];
  }
  if (!(await googleDriveService.isRootConfigured())) {
    logger.warn(
      'DOCUMENT_SOURCE inclui drive mas GOOGLE_DRIVE_ROOT_FOLDER_ID nao esta configurado — nenhum documento sera lido do Drive',
    );
    return [];
  }

  sweepRunning = true;
  try {
    const processes = await db
      .select({
        id: importProcesses.id,
        processCode: importProcesses.processCode,
        brand: importProcesses.brand,
        driveFolderId: importProcesses.driveFolderId,
      })
      .from(importProcesses)
      .where(isNotNull(importProcesses.processCode));

    const results: DriveIngestionResult[] = [];
    for (const process of processes) {
      try {
        results.push(await ingestProcessFromDrive(process));
      } catch (err) {
        logger.error(
          { err, processCode: process.processCode },
          'Drive ingestion failed for process — continuing with the rest',
        );
        results.push({
          processId: process.id,
          processCode: process.processCode,
          imported: 0,
          skipped: 0,
          failed: 1,
        });
      }
    }

    const totals = results.reduce(
      (acc, r) => ({
        imported: acc.imported + r.imported,
        skipped: acc.skipped + r.skipped,
        failed: acc.failed + r.failed,
      }),
      { imported: 0, skipped: 0, failed: 0 },
    );
    const semPasta = results.filter((r) => r.skippedReason).length;
    logger.info(
      { processes: results.length, semPasta, ...totals },
      'Drive ingestion sweep finished',
    );

    return results;
  } finally {
    sweepRunning = false;
  }
}
