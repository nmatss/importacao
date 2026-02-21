import { drive_v3, auth as googleAuth } from '@googleapis/drive';
import { eq } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import { importProcesses } from '../../shared/database/schema.js';
import { logger } from '../../shared/utils/logger.js';

let driveClient: drive_v3.Drive | null = null;

// Cache folder IDs to avoid duplicate creation: "parentId/folderName" -> folderId
const folderCache = new Map<string, string>();

const SUBFOLDER_NAMES = ['Invoice', 'Packing List', 'BL', 'Espelho', 'Outros'] as const;

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
      q: `'${parentId}' in parents and name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
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
      folderCache.set(cacheKey, existing);
      return existing;
    }

    const folderId = await this.createFolder(folderName, parentId);
    folderCache.set(cacheKey, folderId);
    return folderId;
  },

  async ensureProcessFolder(processCode: string, brand: string): Promise<{ processFolderId: string; subfolders: Record<string, string> }> {
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
    const [process] = await db.select({ driveFolderId: importProcesses.driveFolderId })
      .from(importProcesses)
      .where(eq(importProcesses.processCode, processCode))
      .limit(1);

    if (process && !process.driveFolderId) {
      await db.update(importProcesses)
        .set({ driveFolderId: processFolderId, updatedAt: new Date() })
        .where(eq(importProcesses.processCode, processCode));
    }

    logger.info({ processCode, documentType, driveFileId, subfolderName }, 'File uploaded to process folder');
    return driveFileId;
  },

  async listProcessFiles(folderId: string): Promise<drive_v3.Schema$File[]> {
    const drive = getDriveClient();
    const allFiles: drive_v3.Schema$File[] = [];

    async function listRecursive(parentId: string) {
      let pageToken: string | undefined;
      do {
        const response = await drive.files.list({
          q: `'${parentId}' in parents and trashed = false`,
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
