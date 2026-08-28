import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { fileTypeFromBuffer } from 'file-type';
import { db } from '../../shared/database/connection.js';
import { importProcesses } from '../../shared/database/schema.js';
import { UPLOAD_DIR } from '../../shared/config/paths.js';
import { AppError } from '../../shared/errors/index.js';
import { logger } from '../../shared/utils/logger.js';
import { googleDriveService } from '../integrations/google-drive.service.js';
import { documentService } from '../documents/service.js';
import type { DriveImportInput } from './schema.js';

/**
 * Anexos vindos do Google Drive para a aba de Atendimento.
 *
 * O anexo NAO e um mecanismo de storage paralelo: o arquivo do Drive e baixado e
 * gravado como documento do processo pelo mesmo `documentService.upload()` usado
 * pelo upload do computador, herdando storage, auditoria, timeline e sincronia
 * de volta para o Drive.
 */

/** Mesmo teto do upload multipart (`shared/middleware/upload.ts`). */
const MAX_FILE_SIZE = 50 * 1024 * 1024;

/**
 * Mesmo allowlist do upload multipart. Google Docs nativos ficam de fora de
 * proposito: `files.get?alt=media` nao os exporta, exigiriam `files.export`.
 */
const ALLOWED_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/tiff',
  'image/bmp',
  'text/plain',
  'text/csv',
  'message/rfc822',
  'application/vnd.ms-outlook',
]);

const EXTENSION_BY_MIME: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/msword': '.doc',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/tiff': '.tif',
  'image/bmp': '.bmp',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'message/rfc822': '.eml',
};

const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';

export interface DriveFileOption {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
  webViewLink: string | null;
  createdTime: string | null;
}

function sanitizeFilename(rawName: string, mimeType: string): string {
  const base = path
    .basename(rawName || 'arquivo-drive')
    .replace(/[\r\n]/g, '')
    .split('')
    .map((char) => (char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? '_' : char))
    .join('')
    .slice(0, 200)
    .trim();

  const safeBase = base || 'arquivo-drive';
  if (path.extname(safeBase)) return safeBase;
  return `${safeBase}${EXTENSION_BY_MIME[mimeType] ?? ''}`;
}

/**
 * Pastas do Drive vinculadas ao processo. `driveFolderId` e a pasta da marca e
 * `sistemaDriveFolderId` a pasta gerada pelo sistema; ambas sao do processo.
 */
async function getProcessDriveFolders(processId: number): Promise<string[]> {
  const [proc] = await db
    .select({
      driveFolderId: importProcesses.driveFolderId,
      sistemaDriveFolderId: importProcesses.sistemaDriveFolderId,
    })
    .from(importProcesses)
    .where(eq(importProcesses.id, processId))
    .limit(1);

  if (!proc) throw new AppError('Processo não encontrado', 404, 'PROCESS_NOT_FOUND');

  const folders = [proc.driveFolderId, proc.sistemaDriveFolderId].filter(
    (folderId): folderId is string => Boolean(folderId?.trim()),
  );

  if (folders.length === 0) {
    throw new AppError(
      'Este processo ainda não tem pasta no Google Drive. Anexe o arquivo pelo computador ou sincronize o processo com o Drive.',
      409,
      'PROCESS_DRIVE_FOLDER_MISSING',
    );
  }

  return folders;
}

export const driveAttachmentsService = {
  /** Arquivos anexáveis das pastas do processo (pastas e Google Docs nativos fora). */
  async listProcessFiles(processId: number): Promise<DriveFileOption[]> {
    if (!(await googleDriveService.isRootConfigured())) {
      throw new AppError(
        'Google Drive não está configurado. Cadastre as credenciais em "Configurações > Integrações".',
        503,
        'DRIVE_NOT_CONFIGURED',
      );
    }

    const folders = await getProcessDriveFolders(processId);
    const seen = new Set<string>();
    const options: DriveFileOption[] = [];

    for (const folderId of folders) {
      for (const file of await googleDriveService.listProcessFiles(folderId)) {
        if (!file.id || file.mimeType === DRIVE_FOLDER_MIME) continue;
        if (seen.has(file.id)) continue;
        seen.add(file.id);
        options.push({
          id: file.id,
          name: file.name ?? file.id,
          mimeType: file.mimeType ?? 'application/octet-stream',
          size: file.size != null ? Number(file.size) : null,
          webViewLink: file.webViewLink ?? null,
          createdTime: file.createdTime ?? null,
        });
      }
    }

    return options.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  },

  /**
   * Importa um arquivo do Drive como documento do processo.
   *
   * O `driveFileId` e conferido contra a listagem das pastas do proprio processo
   * antes de qualquer download: sem isso, um id arbitrario faria a service
   * account baixar qualquer arquivo a que ela tem acesso (IDOR/exfiltracao).
   */
  async importToProcess(input: DriveImportInput, userId: number | null) {
    const { processId, driveFileId, documentType } = input;

    const allowed = await this.listProcessFiles(processId);
    const target = allowed.find((file) => file.id === driveFileId);
    if (!target) {
      throw new AppError(
        'Arquivo não pertence às pastas deste processo no Google Drive.',
        403,
        'DRIVE_FILE_NOT_IN_PROCESS',
      );
    }

    if (target.size != null && target.size > MAX_FILE_SIZE) {
      throw new AppError('Arquivo excede o limite de 50MB.', 413, 'DRIVE_FILE_TOO_LARGE');
    }

    const buffer = await googleDriveService.downloadFileBuffer(driveFileId);
    if (buffer.length > MAX_FILE_SIZE) {
      throw new AppError('Arquivo excede o limite de 50MB.', 413, 'DRIVE_FILE_TOO_LARGE');
    }

    // Confia nos magic bytes, nao no mimeType declarado pelo Drive — mesma
    // politica do `validateMagicBytes` do upload multipart.
    const detected = await fileTypeFromBuffer(buffer);
    const effectiveMime = detected?.mime ?? target.mimeType;
    if (!ALLOWED_MIMES.has(effectiveMime)) {
      throw new AppError(
        `Tipo de arquivo não permitido para anexo: ${effectiveMime}`,
        400,
        'DRIVE_FILE_TYPE_NOT_ALLOWED',
      );
    }

    const originalname = sanitizeFilename(target.name, effectiveMime);
    const storedName = `${randomUUID()}${path.extname(originalname) || (EXTENSION_BY_MIME[effectiveMime] ?? '')}`;
    const storagePath = path.join(UPLOAD_DIR, storedName);

    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    await fs.writeFile(storagePath, buffer);

    try {
      // Reaproveita o pipeline de documentos: mesma tabela, auditoria, timeline
      // e sincronia com o Drive do upload feito pelo computador.
      const document = await documentService.upload(
        processId,
        documentType,
        {
          fieldname: 'file',
          originalname,
          encoding: '7bit',
          mimetype: effectiveMime,
          size: buffer.length,
          destination: UPLOAD_DIR,
          filename: storedName,
          path: storagePath,
          buffer: undefined as unknown as Buffer,
          stream: undefined as unknown as NodeJS.ReadableStream,
        } as Express.Multer.File,
        userId,
        { driveFileId, ingestionSource: 'drive' },
      );

      logger.info(
        { processId, driveFileId, documentId: (document as { id?: number })?.id },
        'Arquivo do Drive anexado ao processo',
      );
      return document;
    } catch (error) {
      await fs.unlink(storagePath).catch(() => {});
      throw error;
    }
  },
};
