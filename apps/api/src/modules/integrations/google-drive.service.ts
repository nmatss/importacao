import { drive_v3, auth as googleAuth } from '@googleapis/drive';
import { eq } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import { importProcesses } from '../../shared/database/schema.js';
import { logger } from '../../shared/utils/logger.js';

let driveClient: drive_v3.Drive | null = null;

// Cache folder IDs to avoid duplicate creation: "parentId/folderName" -> folderId
// LRU-like cache with max size to prevent unbounded memory growth
const FOLDER_CACHE_MAX = 1000;
const folderCache = new Map<string, string>();

function folderCacheSet(key: string, value: string): void {
  if (folderCache.size >= FOLDER_CACHE_MAX) {
    // Delete oldest entry (first key in Map iteration order)
    const firstKey = folderCache.keys().next().value;
    if (firstKey !== undefined) folderCache.delete(firstKey);
  }
  folderCache.set(key, value);
}

const SUBFOLDER_NAMES = ['Invoice', 'Packing List', 'BL', 'Espelho', 'Outros'] as const;

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
  const privateKey = process.env.GOOGLE_DRIVE_PRIVATE_KEY?.replace(/\\n/g, '\n');

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
    const rootFolderId = parentId || process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;

    const response = await drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: rootFolderId ? [rootFolderId] : undefined,
      },
      fields: 'id',
    });

    const folderId = response.data.id!;
    logger.info({ folderId, name }, 'Google Drive folder created');
    return folderId;
  },

  async uploadFile(filePath: string, fileName: string, folderId: string): Promise<string> {
    const drive = getDriveClient();
    const fs = await import('fs');

    const response = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [folderId],
      },
      media: {
        body: fs.createReadStream(filePath),
      },
      fields: 'id, webViewLink',
    });

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

  async findFolder(parentId: string, folderName: string): Promise<string | null> {
    const drive = getDriveClient();
    const response = await drive.files.list({
      q: `'${escapeDriveQuery(parentId)}' in parents and name = '${escapeDriveQuery(folderName)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name)',
      pageSize: 1,
    });
    return response.data.files?.[0]?.id ?? null;
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
    const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
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
    const configured = await this.isConfigured();
    if (!configured) return;

    const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
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
    await drive.files.update({
      fileId: processFolderId,
      addParents: correctionFolderId,
      removeParents: brandFolderId,
      fields: 'id, parents',
    });

    logger.info({ processCode, correctionFolderId }, 'Process moved to correction folder');
  },

  async moveFromCorrection(processCode: string, brand: string): Promise<void> {
    const configured = await this.isConfigured();
    if (!configured) return;

    const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
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
    await drive.files.update({
      fileId: processFolderId,
      addParents: brandFolderId,
      removeParents: correctionFolderId,
      fields: 'id, parents',
    });

    logger.info({ processCode }, 'Process moved from correction back to brand folder');
  },

  // ── Sistema Automatico methods ──────────────────────────────────────

  async ensureSistemaFolder(): Promise<string> {
    const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
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
    const configured = await this.isConfigured();
    if (!configured) throw new Error('Google Drive not configured');
    const inboxId = await this.ensureSistemaInbox();
    return this.uploadFile(filePath, fileName, inboxId);
  },

  async moveFromInboxToProcessados(
    fileId: string,
    processCode: string,
    docType: string,
  ): Promise<void> {
    const configured = await this.isConfigured();
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
      await drive.files.update({
        fileId,
        addParents: targetFolder,
        removeParents: inboxId,
        fields: 'id, parents',
      });
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
    const configured = await this.isConfigured();
    if (!configured) throw new Error('Google Drive not configured');

    const subfolders = await this.ensureSistemaProcessFolder(processCode);
    const reportFolderId = subfolders['Relatorio de Validacao'];

    const drive = getDriveClient();
    const { Readable } = await import('stream');

    const content = JSON.stringify(reportData, null, 2);
    const fileName = `validacao_${processCode}_${new Date().toISOString().slice(0, 10)}.json`;

    const response = await drive.files.create({
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
    });

    const fileId = response.data.id!;
    logger.info({ fileId, processCode }, 'Validation report uploaded to Sistema Automatico');
    return fileId;
  },

  async uploadToAlertas(fileName: string, content: string): Promise<string> {
    const configured = await this.isConfigured();
    if (!configured) throw new Error('Google Drive not configured');

    const sistemaId = await this.ensureSistemaFolder();
    const alertasId = await this.ensureFolder(sistemaId, 'ALERTAS');

    const drive = getDriveClient();
    const { Readable } = await import('stream');

    const response = await drive.files.create({
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
    });

    const fileId = response.data.id!;
    logger.info({ fileId, fileName }, 'Alert uploaded to ALERTAS folder');
    return fileId;
  },

  async listProcessFiles(folderId: string): Promise<drive_v3.Schema$File[]> {
    const drive = getDriveClient();
    const allFiles: drive_v3.Schema$File[] = [];

    async function listRecursive(parentId: string) {
      let pageToken: string | undefined;
      do {
        const response = await drive.files.list({
          q: `'${escapeDriveQuery(parentId)}' in parents and trashed = false`,
          fields: 'nextPageToken, files(id, name, mimeType, size, webViewLink, createdTime)',
          pageSize: 100,
          pageToken,
        });

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
