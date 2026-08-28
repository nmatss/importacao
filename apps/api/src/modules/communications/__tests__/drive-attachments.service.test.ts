import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';

const { mockDb, queryQueue } = createMockDb();

const mockIsRootConfigured = vi.hoisted(() => vi.fn());
const mockListProcessFiles = vi.hoisted(() => vi.fn());
const mockDownloadFileBuffer = vi.hoisted(() => vi.fn());
const mockDocumentUpload = vi.hoisted(() => vi.fn());
const mockWriteFile = vi.hoisted(() => vi.fn());
const mockUnlink = vi.hoisted(() => vi.fn());

vi.mock('../../../shared/database/connection.js', () => ({ db: mockDb }));

vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../integrations/google-drive.service.js', () => ({
  googleDriveService: {
    isRootConfigured: (...args: any[]) => mockIsRootConfigured(...args),
    listProcessFiles: (...args: any[]) => mockListProcessFiles(...args),
    downloadFileBuffer: (...args: any[]) => mockDownloadFileBuffer(...args),
  },
}));

vi.mock('../../documents/service.js', () => ({
  documentService: { upload: (...args: any[]) => mockDocumentUpload(...args) },
}));

vi.mock('node:fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: (...args: any[]) => mockWriteFile(...args),
    unlink: (...args: any[]) => mockUnlink(...args),
  },
}));

const { driveAttachmentsService } = await import('../drive-attachments.service.js');

/** PDF minimo — magic bytes `%PDF` sao o que o servico usa para decidir o MIME. */
const PDF_BUFFER = Buffer.from('%PDF-1.4\n%%EOF\n');

function queueProcessFolders(folders: { driveFolderId?: string; sistemaDriveFolderId?: string }) {
  queryQueue.push(
    createResolvedChain([
      {
        driveFolderId: folders.driveFolderId ?? null,
        sistemaDriveFolderId: folders.sistemaDriveFolderId ?? null,
      },
    ]),
  );
}

describe('driveAttachmentsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
    mockIsRootConfigured.mockResolvedValue(true);
    mockWriteFile.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
    mockDocumentUpload.mockResolvedValue({ id: 42 });
  });

  describe('listProcessFiles()', () => {
    it('lists files from both process folders, skipping folders themselves', async () => {
      queueProcessFolders({
        driveFolderId: 'folder-marca',
        sistemaDriveFolderId: 'folder-sistema',
      });
      mockListProcessFiles
        .mockResolvedValueOnce([
          { id: 'f1', name: 'invoice.pdf', mimeType: 'application/pdf', size: '120' },
          { id: 'sub', name: 'Outros', mimeType: 'application/vnd.google-apps.folder' },
        ])
        .mockResolvedValueOnce([
          { id: 'f2', name: 'ohbl.pdf', mimeType: 'application/pdf', size: '200' },
          // Duplicado entre as duas pastas — deve aparecer uma unica vez.
          { id: 'f1', name: 'invoice.pdf', mimeType: 'application/pdf', size: '120' },
        ]);

      const files = await driveAttachmentsService.listProcessFiles(1);

      expect(files.map((file) => file.id)).toEqual(['f1', 'f2']);
    });

    it('fails when Google Drive is not configured', async () => {
      mockIsRootConfigured.mockResolvedValue(false);

      await expect(driveAttachmentsService.listProcessFiles(1)).rejects.toThrow(
        'Google Drive não está configurado',
      );
    });

    it('fails when the process has no Drive folder', async () => {
      queueProcessFolders({});

      await expect(driveAttachmentsService.listProcessFiles(1)).rejects.toThrow(
        'ainda não tem pasta no Google Drive',
      );
    });
  });

  describe('importToProcess()', () => {
    it('refuses a driveFileId outside the process folders and never downloads it', async () => {
      queueProcessFolders({ driveFolderId: 'folder-marca' });
      mockListProcessFiles.mockResolvedValue([
        { id: 'f1', name: 'invoice.pdf', mimeType: 'application/pdf', size: '120' },
      ]);

      await expect(
        driveAttachmentsService.importToProcess(
          { processId: 1, driveFileId: 'outro-processo', documentType: 'other' },
          7,
        ),
      ).rejects.toThrow('não pertence às pastas deste processo');

      expect(mockDownloadFileBuffer).not.toHaveBeenCalled();
      expect(mockDocumentUpload).not.toHaveBeenCalled();
    });

    it('rejects a file above the 50MB limit before downloading it', async () => {
      queueProcessFolders({ driveFolderId: 'folder-marca' });
      mockListProcessFiles.mockResolvedValue([
        {
          id: 'big',
          name: 'grande.pdf',
          mimeType: 'application/pdf',
          size: String(60 * 1024 * 1024),
        },
      ]);

      await expect(
        driveAttachmentsService.importToProcess(
          { processId: 1, driveFileId: 'big', documentType: 'other' },
          7,
        ),
      ).rejects.toThrow('excede o limite de 50MB');

      expect(mockDownloadFileBuffer).not.toHaveBeenCalled();
    });

    it('rejects content whose magic bytes are not an allowed type', async () => {
      queueProcessFolders({ driveFolderId: 'folder-marca' });
      mockListProcessFiles.mockResolvedValue([
        { id: 'f1', name: 'fake.pdf', mimeType: 'application/pdf', size: '10' },
      ]);
      // Executavel ELF disfarcado de PDF pelo mimeType declarado no Drive.
      mockDownloadFileBuffer.mockResolvedValue(Buffer.from('\x7fELF\x02\x01\x01\x00binario'));

      await expect(
        driveAttachmentsService.importToProcess(
          { processId: 1, driveFileId: 'f1', documentType: 'other' },
          7,
        ),
      ).rejects.toThrow('Tipo de arquivo não permitido');

      expect(mockDocumentUpload).not.toHaveBeenCalled();
    });

    it('saves an allowed file through the shared document pipeline', async () => {
      queueProcessFolders({ driveFolderId: 'folder-marca' });
      mockListProcessFiles.mockResolvedValue([
        { id: 'f1', name: 'invoice.pdf', mimeType: 'application/pdf', size: '120' },
      ]);
      mockDownloadFileBuffer.mockResolvedValue(PDF_BUFFER);

      const document = await driveAttachmentsService.importToProcess(
        { processId: 1, driveFileId: 'f1', documentType: 'other' },
        7,
      );

      expect(document).toEqual({ id: 42 });
      expect(mockWriteFile).toHaveBeenCalledTimes(1);
      expect(mockDocumentUpload).toHaveBeenCalledWith(
        1,
        'other',
        expect.objectContaining({
          originalname: 'invoice.pdf',
          mimetype: 'application/pdf',
          size: PDF_BUFFER.length,
        }),
        7,
        { driveFileId: 'f1', ingestionSource: 'drive' },
      );
    });

    it('removes the staged file when the document pipeline fails', async () => {
      queueProcessFolders({ driveFolderId: 'folder-marca' });
      mockListProcessFiles.mockResolvedValue([
        { id: 'f1', name: 'invoice.pdf', mimeType: 'application/pdf', size: '120' },
      ]);
      mockDownloadFileBuffer.mockResolvedValue(PDF_BUFFER);
      mockDocumentUpload.mockRejectedValue(new Error('processo bloqueado'));

      await expect(
        driveAttachmentsService.importToProcess(
          { processId: 1, driveFileId: 'f1', documentType: 'other' },
          7,
        ),
      ).rejects.toThrow('processo bloqueado');

      expect(mockUnlink).toHaveBeenCalledTimes(1);
    });
  });
});
