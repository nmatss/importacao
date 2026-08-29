import { drive_v3, auth as googleAuth } from '@googleapis/drive';
import { eq } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import { importProcesses } from '../../shared/database/schema.js';
import { normalizeGooglePrivateKey } from '../../shared/utils/google-private-key.js';
import { logger } from '../../shared/utils/logger.js';
import { withRetry, withTimeout } from '../../shared/utils/resilience.js';
import { integrationRetryOptions } from './retry-policy.js';

const DRIVE_API_TIMEOUT_MS = 30_000;

/**
 * Timeout de guarda das chamadas do Drive, agora com cancelamento REAL.
 *
 * A versao anterior era um `Promise.race` com `setTimeout`: a promessa perdedora
 * era descartada, mas a requisicao seguia em voo — o cliente do Google
 * continuava esperando a resposta, segurando socket e custo. `withTimeout` de
 * `shared/utils/resilience.ts` cria um `AbortController`, e os clientes
 * `@googleapis/*` aceitam `signal` por requisicao (MethodOptions estende
 * GaxiosOptions, que estende RequestInit), entao o abort chega ao fetch.
 */
function driveCall<T>(label: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  return withTimeout(fn, DRIVE_API_TIMEOUT_MS, `Google Drive ${label}`);
}

/**
 * LEITURA: timeout com cancelamento + re-tentativa.
 *
 * So caminho de leitura entra aqui. Re-tentar `files.create` duplicaria pasta ou
 * arquivo no Drive quando a primeira chamada tivesse dado certo e so a resposta
 * se perdesse — e o upload ainda reusaria um ReadStream ja consumido. Por isso
 * as escritas usam `driveCall` puro, sem retry.
 */
function driveRead<T>(label: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  return withRetry(() => driveCall(label, fn), integrationRetryOptions, `drive:${label}`);
}

let driveClient: drive_v3.Drive | null = null;

// Cache folder IDs to avoid duplicate creation: "parentId/folderName" -> folderId
// LRU-like cache with max size to prevent unbounded memory growth
const FOLDER_CACHE_MAX = 1000;
const folderCache = new Map<string, string>();
export const ROOT_FOLDER_PLACEHOLDERS = new Set(['your-root-folder-id']);

function getConfiguredRootFolderId(): string | null {
  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID?.trim();
  if (!rootFolderId || ROOT_FOLDER_PLACEHOLDERS.has(rootFolderId)) return null;
  return rootFolderId;
}

function folderCacheSet(key: string, value: string): void {
  if (folderCache.size >= FOLDER_CACHE_MAX) {
    // Delete oldest entry (first key in Map iteration order)
    const firstKey = folderCache.keys().next().value;
    if (firstKey !== undefined) folderCache.delete(firstKey);
  }
  folderCache.set(key, value);
}

const SUBFOLDER_NAMES = ['Invoice', 'Packing List', 'BL', 'Espelho', 'Outros'] as const;
const PROCESS_FOLDER_PREFIXES = ['', 'Processo Nº ', 'Processo N° ', 'Processo No '] as const;

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

const DOC_TYPE_TO_SUBFOLDER: Record<string, string> = {
  invoice: 'Invoice',
  packing_list: 'Packing List',
  ohbl: 'BL',
  espelho: 'Espelho',
};

function getDriveClient(): drive_v3.Drive {
  if (driveClient) return driveClient;

  const clientEmail = process.env.GOOGLE_DRIVE_CLIENT_EMAIL;
  const privateKey = normalizeGooglePrivateKey(process.env.GOOGLE_DRIVE_PRIVATE_KEY);

  if (!clientEmail || !privateKey) {
    throw new Error('Google Drive credentials not configured');
  }

  const auth = new googleAuth.GoogleAuth({
    credentials: { client_email: clientEmail, private_key: privateKey },
    scopes: ['https://www.googleapis.com/auth/drive'],
  });

  driveClient = new drive_v3.Drive({ auth });
  return driveClient;
}

export const googleDriveService = {
  async createFolder(name: string, parentId?: string): Promise<string> {
    const drive = getDriveClient();
    const rootFolderId = parentId || getConfiguredRootFolderId();
    if (!rootFolderId) throw new Error('GOOGLE_DRIVE_ROOT_FOLDER_ID not configured');

    const response = await driveCall(`createFolder(${name})`, (signal) =>
      drive.files.create(
        {
          requestBody: {
            name,
            mimeType: 'application/vnd.google-apps.folder',
            parents: rootFolderId ? [rootFolderId] : undefined,
          },
          fields: 'id',
          supportsAllDrives: true,
        },
        { signal },
      ),
    );

    const folderId = response.data.id!;
    logger.info({ folderId, name }, 'Google Drive folder created');
    return folderId;
  },

  async uploadFile(filePath: string, fileName: string, folderId: string): Promise<string> {
    const drive = getDriveClient();
    const fs = await import('fs');

    const response = await driveCall(`uploadFile(${fileName})`, (signal) =>
      drive.files.create(
        {
          requestBody: {
            name: fileName,
            parents: [folderId],
          },
          media: {
            body: fs.createReadStream(filePath),
          },
          fields: 'id, webViewLink',
          supportsAllDrives: true,
        },
        { signal },
      ),
    );

    const fileId = response.data.id!;
    logger.info({ fileId, fileName }, 'File uploaded to Google Drive');
    return fileId;
  },

  getFileUrl(fileId: string): string {
    return `https://drive.google.com/file/d/${fileId}/view`;
  },

  async isConfigured(): Promise<boolean> {
    return !!(process.env.GOOGLE_DRIVE_CLIENT_EMAIL && process.env.GOOGLE_DRIVE_PRIVATE_KEY);
  },

  async isRootConfigured(): Promise<boolean> {
    return (await this.isConfigured()) && Boolean(getConfiguredRootFolderId());
  },

  /**
   * Read-only proof that the configured root exists, is a folder and is
   * accessible.
   *
   * DELIBERADAMENTE SEM RETRY: e sonda de health. Uma sonda que insiste tres
   * vezes mente sobre a latencia do ambiente e transforma `/health/integrations`
   * num endpoint de 90s quando o Drive esta inalcancavel. Aqui a primeira
   * resposta e a resposta.
   */
  async testRootAccess(): Promise<boolean> {
    const rootFolderId = getConfiguredRootFolderId();
    if (!(await this.isConfigured()) || !rootFolderId) return false;

    try {
      const drive = getDriveClient();
      const response = await driveCall('testRootAccess', (signal) =>
        drive.files.get(
          {
            fileId: rootFolderId,
            fields: 'id,mimeType,trashed',
            supportsAllDrives: true,
          },
          { signal },
        ),
      );
      return (
        response.data.mimeType === 'application/vnd.google-apps.folder' &&
        response.data.trashed !== true
      );
    } catch (error) {
      logger.warn({ err: error }, 'Configured Google Drive root is not accessible');
      return false;
    }
  },

  async findFolder(parentId: string, folderName: string): Promise<string | null> {
    const drive = getDriveClient();
    const response = await driveRead(`findFolder(${folderName})`, (signal) =>
      drive.files.list(
        {
          q: `'${escapeDriveQuery(parentId)}' in parents and name = '${escapeDriveQuery(folderName)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
          fields: 'files(id, name)',
          pageSize: 1,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        },
        { signal },
      ),
    );
    return response.data.files?.[0]?.id ?? null;
  },

  async listChildFolders(parentId: string): Promise<Array<{ id: string; name: string }>> {
    const drive = getDriveClient();
    const folders: Array<{ id: string; name: string }> = [];
    let pageToken: string | undefined;

    do {
      const response = await driveRead(`listChildFolders(${parentId})`, (signal) =>
        drive.files.list(
          {
            q: `'${escapeDriveQuery(parentId)}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
            fields: 'nextPageToken, files(id, name)',
            pageSize: 100,
            pageToken,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
          },
          { signal },
        ),
      );

      for (const folder of response.data.files ?? []) {
        if (folder.id && folder.name) folders.push({ id: folder.id, name: folder.name });
      }
      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);

    return folders;
  },

  async ensureFolder(parentId: string, folderName: string): Promise<string> {
    const cacheKey = `${parentId}/${folderName}`;
    const cached = folderCache.get(cacheKey);
    if (cached) return cached;

    const existing = await this.findFolder(parentId, folderName);
    if (existing) {
      folderCacheSet(cacheKey, existing);
      return existing;
    }

    const folderId = await this.createFolder(folderName, parentId);
    folderCacheSet(cacheKey, folderId);
    return folderId;
  },

  async ensureProcessFolder(
    processCode: string,
    brand: string,
  ): Promise<{ processFolderId: string; subfolders: Record<string, string> }> {
    const rootFolderId = getConfiguredRootFolderId();
    if (!rootFolderId) throw new Error('GOOGLE_DRIVE_ROOT_FOLDER_ID not configured');

    const brandName = brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase();
    const brandFolderId = await this.ensureFolder(rootFolderId, brandName);
    const processFolderId = await this.ensureFolder(brandFolderId, processCode);

    const subfolders: Record<string, string> = {};
    for (const name of SUBFOLDER_NAMES) {
      subfolders[name] = await this.ensureFolder(processFolderId, name);
    }

    return { processFolderId, subfolders };
  },

  /**
   * Locate the folder of an existing process WITHOUT creating anything.
   *
   * `ensureProcessFolder` is the write path and creates the brand/process/
   * subfolder tree as a side effect. Ingestion must never do that: a process
   * whose folder does not exist yet simply has no documents to read, and
   * creating empty folders in the team's Drive would be noise.
   */
  async findProcessFolder(processCode: string, brand: string): Promise<string | null> {
    const rootFolderId = getConfiguredRootFolderId();
    if (!rootFolderId) return null;

    const brandName = brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase();
    const brandFolderId = await this.findFolder(rootFolderId, brandName);
    if (!brandFolderId) return null;

    const candidateNames = PROCESS_FOLDER_PREFIXES.map((prefix) => `${prefix}${processCode}`);
    for (const candidateName of candidateNames) {
      const directMatch = await this.findFolder(brandFolderId, candidateName);
      if (directMatch) return directMatch;
    }

    // Estrutura operacional real observada no Shared Drive:
    //   <ano>/<Marca>/Importado/Processo Nº <codigo>
    // A busca fica limitada a um nível intermediário da marca para não fazer
    // varredura recursiva ampla nem aceitar uma pasta homônima fora da raiz.
    const operationalGroups = await this.listChildFolders(brandFolderId);
    for (const group of operationalGroups) {
      for (const candidateName of candidateNames) {
        const nestedMatch = await this.findFolder(group.id, candidateName);
        if (nestedMatch) return nestedMatch;
      }
    }

    return null;
  },

  async uploadToProcessFolder(
    processCode: string,
    brand: string,
    documentType: string,
    filePath: string,
    fileName: string,
  ): Promise<string> {
    const { processFolderId, subfolders } = await this.ensureProcessFolder(processCode, brand);
    const subfolderName = DOC_TYPE_TO_SUBFOLDER[documentType] || 'Outros';
    const targetFolderId = subfolders[subfolderName];

    const driveFileId = await this.uploadFile(filePath, fileName, targetFolderId);

    // Update process driveFolderId if not set yet
    const [process] = await db
      .select({ driveFolderId: importProcesses.driveFolderId })
      .from(importProcesses)
      .where(eq(importProcesses.processCode, processCode))
      .limit(1);

    if (process && !process.driveFolderId) {
      await db
        .update(importProcesses)
        .set({ driveFolderId: processFolderId, updatedAt: new Date() })
        .where(eq(importProcesses.processCode, processCode));
    }

    logger.info(
      { processCode, documentType, driveFileId, subfolderName },
      'File uploaded to process folder',
    );
    return driveFileId;
  },

  async moveToCorrection(processCode: string, brand: string): Promise<void> {
    const configured = await this.isRootConfigured();
    if (!configured) return;

    const rootFolderId = getConfiguredRootFolderId();
    if (!rootFolderId) return;

    const brandName = brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase();
    const brandFolderId = await this.ensureFolder(rootFolderId, brandName);

    // Find the process folder
    const processFolderId = await this.findFolder(brandFolderId, processCode);
    if (!processFolderId) {
      logger.warn({ processCode }, 'Process folder not found for correction move');
      return;
    }

    // Create/ensure correction folder under brand
    const correctionFolderId = await this.ensureFolder(brandFolderId, 'PENDENTES DE CORREÇÃO');

    // Move process folder: remove from brand, add to correction
    const drive = getDriveClient();
    await driveCall(`moveToCorrection(${processCode})`, (signal) =>
      drive.files.update(
        {
          fileId: processFolderId,
          addParents: correctionFolderId,
          removeParents: brandFolderId,
          fields: 'id, parents',
          supportsAllDrives: true,
        },
        { signal },
      ),
    );

    logger.info({ processCode, correctionFolderId }, 'Process moved to correction folder');
  },

  async moveFromCorrection(processCode: string, brand: string): Promise<void> {
    const configured = await this.isRootConfigured();
    if (!configured) return;

    const rootFolderId = getConfiguredRootFolderId();
    if (!rootFolderId) return;

    const brandName = brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase();
    const brandFolderId = await this.ensureFolder(rootFolderId, brandName);

    // Find correction folder
    const correctionFolderId = await this.findFolder(brandFolderId, 'PENDENTES DE CORREÇÃO');
    if (!correctionFolderId) return;

    // Find process folder inside correction
    const processFolderId = await this.findFolder(correctionFolderId, processCode);
    if (!processFolderId) {
      logger.warn({ processCode }, 'Process folder not found in correction folder');
      return;
    }

    // Move back: remove from correction, add to brand
    const drive = getDriveClient();
    await driveCall(`moveFromCorrection(${processCode})`, (signal) =>
      drive.files.update(
        {
          fileId: processFolderId,
          addParents: brandFolderId,
          removeParents: correctionFolderId,
          fields: 'id, parents',
          supportsAllDrives: true,
        },
        { signal },
      ),
    );

    logger.info({ processCode }, 'Process moved from correction back to brand folder');
  },

  // ── Sistema Automatico methods ──────────────────────────────────────

  async ensureSistemaFolder(): Promise<string> {
    const rootFolderId = getConfiguredRootFolderId();
    if (!rootFolderId) throw new Error('GOOGLE_DRIVE_ROOT_FOLDER_ID not configured');
    return this.ensureFolder(rootFolderId, '00. SISTEMA AUTOMATICO');
  },

  async ensureSistemaInbox(): Promise<string> {
    const sistemaId = await this.ensureSistemaFolder();
    return this.ensureFolder(sistemaId, 'INBOX');
  },

  async ensureSistemaProcessFolder(processCode: string): Promise<Record<string, string>> {
    const sistemaId = await this.ensureSistemaFolder();
    const processadosId = await this.ensureFolder(sistemaId, 'PROCESSADOS');
    const processFolderId = await this.ensureFolder(processadosId, processCode);

    // Store sistemaDriveFolderId back to importProcesses
    try {
      await db
        .update(importProcesses)
        .set({ sistemaDriveFolderId: processFolderId, updatedAt: new Date() })
        .where(eq(importProcesses.processCode, processCode));
    } catch (err) {
      logger.warn({ err, processCode }, 'Failed to store sistemaDriveFolderId');
    }

    const subfolders: Record<string, string> = {};
    for (const name of ['Invoice', 'Packing List', 'BL', 'Relatorio de Validacao']) {
      subfolders[name] = await this.ensureFolder(processFolderId, name);
    }
    return subfolders;
  },

  async uploadToSistemaInbox(filePath: string, fileName: string): Promise<string> {
    const configured = await this.isRootConfigured();
    if (!configured) throw new Error('Google Drive not configured');
    const inboxId = await this.ensureSistemaInbox();
    return this.uploadFile(filePath, fileName, inboxId);
  },

  async moveFromInboxToProcessados(
    fileId: string,
    processCode: string,
    docType: string,
  ): Promise<void> {
    const configured = await this.isRootConfigured();
    if (!configured) return;

    const subfolders = await this.ensureSistemaProcessFolder(processCode);
    const docTypeMap: Record<string, string> = {
      invoice: 'Invoice',
      packing_list: 'Packing List',
      ohbl: 'BL',
    };
    const targetFolder = subfolders[docTypeMap[docType] || 'Invoice'];
    if (!targetFolder) return;

    const inboxId = await this.ensureSistemaInbox();
    const drive = getDriveClient();

    try {
      await driveCall(`moveFromInboxToProcessados(${processCode})`, (signal) =>
        drive.files.update(
          {
            fileId,
            addParents: targetFolder,
            removeParents: inboxId,
            fields: 'id, parents',
            supportsAllDrives: true,
          },
          { signal },
        ),
      );
      logger.info({ fileId, processCode, docType }, 'File moved from INBOX to PROCESSADOS');
    } catch (err: any) {
      if (err?.code === 404) {
        logger.warn({ fileId, processCode }, 'File not found in INBOX, skipping move');
        return;
      }
      throw err;
    }
  },

  async uploadValidationReport(
    processCode: string,
    reportData: Record<string, any>,
  ): Promise<string> {
    const configured = await this.isRootConfigured();
    if (!configured) throw new Error('Google Drive not configured');

    const subfolders = await this.ensureSistemaProcessFolder(processCode);
    const reportFolderId = subfolders['Relatorio de Validacao'];

    const drive = getDriveClient();
    const { Readable } = await import('stream');

    const content = JSON.stringify(reportData, null, 2);
    const fileName = `validacao_${processCode}_${new Date().toISOString().slice(0, 10)}.json`;

    const response = await driveCall(`uploadValidationReport(${processCode})`, (signal) =>
      drive.files.create(
        {
          requestBody: {
            name: fileName,
            parents: [reportFolderId],
            mimeType: 'application/json',
          },
          media: {
            mimeType: 'application/json',
            body: Readable.from(content),
          },
          fields: 'id',
          supportsAllDrives: true,
        },
        { signal },
      ),
    );

    const fileId = response.data.id!;
    logger.info({ fileId, processCode }, 'Validation report uploaded to Sistema Automatico');
    return fileId;
  },

  async uploadToAlertas(fileName: string, content: string): Promise<string> {
    const configured = await this.isRootConfigured();
    if (!configured) throw new Error('Google Drive not configured');

    const sistemaId = await this.ensureSistemaFolder();
    const alertasId = await this.ensureFolder(sistemaId, 'ALERTAS');

    const drive = getDriveClient();
    const { Readable } = await import('stream');

    const response = await driveCall(`uploadToAlertas(${fileName})`, (signal) =>
      drive.files.create(
        {
          requestBody: {
            name: fileName,
            parents: [alertasId],
            mimeType: 'application/json',
          },
          media: {
            mimeType: 'application/json',
            body: Readable.from(content),
          },
          fields: 'id',
          supportsAllDrives: true,
        },
        { signal },
      ),
    );

    const fileId = response.data.id!;
    logger.info({ fileId, fileName }, 'Alert uploaded to ALERTAS folder');
    return fileId;
  },

  /**
   * Find the most-recently-modified xlsx with "pre-cons"/"precons" in the
   * name inside the configured folder. Folder ID comes from
   * GOOGLE_DRIVE_PRE_CONS_FOLDER_ID. Returns null when nothing matches.
   */
  async findLatestPreConsXlsx(): Promise<{
    id: string;
    name: string;
    modifiedTime: string | null;
  } | null> {
    const folderId = process.env.GOOGLE_DRIVE_PRE_CONS_FOLDER_ID;
    if (!folderId) return null;
    const drive = getDriveClient();
    const response = await driveRead('findLatestPreConsXlsx', (signal) =>
      drive.files.list(
        {
          q: `'${escapeDriveQuery(folderId)}' in parents and trashed = false and (mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' or mimeType = 'application/vnd.ms-excel')`,
          fields: 'files(id, name, modifiedTime, mimeType)',
          orderBy: 'modifiedTime desc',
          pageSize: 25,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        },
        { signal },
      ),
    );
    const candidates = (response.data.files ?? []).filter((f) => /pre.?cons/i.test(f.name ?? ''));
    const best = candidates[0] ?? response.data.files?.[0];
    if (!best?.id) return null;
    return {
      id: best.id,
      name: best.name ?? 'pre-cons.xlsx',
      modifiedTime: best.modifiedTime ?? null,
    };
  },

  async downloadFileBuffer(fileId: string): Promise<Buffer> {
    const drive = getDriveClient();
    const response = await driveRead(`downloadFileBuffer(${fileId})`, (signal) =>
      drive.files.get(
        { fileId, alt: 'media', supportsAllDrives: true },
        { responseType: 'arraybuffer', signal },
      ),
    );
    return Buffer.from(response.data as ArrayBuffer);
  },

  async listProcessFiles(folderId: string): Promise<drive_v3.Schema$File[]> {
    const drive = getDriveClient();
    const allFiles: drive_v3.Schema$File[] = [];

    async function listRecursive(parentId: string) {
      let pageToken: string | undefined;
      do {
        const response = await driveRead(`listProcessFiles(${parentId})`, (signal) =>
          drive.files.list(
            {
              q: `'${escapeDriveQuery(parentId)}' in parents and trashed = false`,
              fields: 'nextPageToken, files(id, name, mimeType, size, webViewLink, createdTime)',
              pageSize: 100,
              pageToken,
              supportsAllDrives: true,
              includeItemsFromAllDrives: true,
            },
            { signal },
          ),
        );

        for (const file of response.data.files || []) {
          allFiles.push(file);
          if (file.mimeType === 'application/vnd.google-apps.folder' && file.id) {
            await listRecursive(file.id);
          }
        }
        pageToken = response.data.nextPageToken ?? undefined;
      } while (pageToken);
    }

    await listRecursive(folderId);
    return allFiles;
  },
};
