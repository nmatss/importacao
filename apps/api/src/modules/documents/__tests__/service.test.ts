import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';

const { mockDb, queryQueue } = createMockDb();

vi.mock('../../../shared/database/connection.js', () => ({
  db: mockDb,
}));

vi.mock('../../audit/service.js', () => ({
  auditService: { log: vi.fn() },
}));

vi.mock('../../alerts/service.js', () => ({
  alertService: { create: vi.fn().mockResolvedValue({}) },
}));

vi.mock('../../ai/service.js', () => ({
  aiService: {
    extractInvoiceData: vi.fn().mockResolvedValue({ data: {}, confidenceScore: 0.9 }),
    extractPackingListData: vi.fn().mockResolvedValue({ data: {}, confidenceScore: 0.85 }),
    extractBLData: vi.fn().mockResolvedValue({ data: {}, confidenceScore: 0.88 }),
  },
}));

vi.mock('../../integrations/google-drive.service.js', () => ({
  googleDriveService: {
    isConfigured: vi.fn().mockResolvedValue(false),
    uploadToProcessFolder: vi.fn().mockResolvedValue('drive-file-id'),
  },
}));

vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../shared/state-machine/process-states.js', () => ({
  assertTransition: vi.fn(),
}));

const mockFsUnlink = vi.fn().mockResolvedValue(undefined);
const mockFsReadFile = vi.fn().mockResolvedValue(Buffer.from('mock content'));

vi.mock('fs/promises', () => ({
  default: {
    readFile: mockFsReadFile,
    unlink: mockFsUnlink,
  },
}));

vi.mock('pdf-parse', () => ({
  default: vi.fn().mockResolvedValue({ text: 'Extracted PDF text' }),
}));

vi.mock('xlsx', () => ({
  read: vi.fn().mockReturnValue({
    SheetNames: ['Sheet1'],
    Sheets: { Sheet1: {} },
  }),
  utils: {
    sheet_to_csv: vi.fn().mockReturnValue('col1,col2\nval1,val2'),
  },
}));

const { documentService } = await import('../service.js');
const { auditService } = await import('../../audit/service.js');

describe('documentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
  });

  describe('upload()', () => {
    it('should insert document and trigger AI processing', async () => {
      const mockDoc = { id: 1, processId: 1, type: 'invoice' };
      const mockFile = {
        originalname: 'invoice.pdf',
        path: '/tmp/invoice.pdf',
        mimetype: 'application/pdf',
        size: 1024,
      } as Express.Multer.File;

      // insert document returning
      queryQueue.push(createResolvedChain([mockDoc]));
      // select docs to check all 3 present -> only 1 doc
      queryQueue.push(createResolvedChain([{ type: 'invoice' }]));

      const result = await documentService.upload(1, 'invoice', mockFile, 1);

      expect(result).toEqual(mockDoc);
      expect(mockDb.insert).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        1,
        'upload',
        'document',
        1,
        expect.objectContaining({ processId: 1, type: 'invoice' }),
        null,
      );
    });

    it('should update status to documents_received when all 3 docs present', async () => {
      const mockDoc = { id: 3, processId: 1, type: 'ohbl' };
      const mockFile = {
        originalname: 'bl.pdf',
        path: '/tmp/bl.pdf',
        mimetype: 'application/pdf',
        size: 2048,
      } as Express.Multer.File;

      const allDocs = [
        { type: 'invoice' },
        { type: 'packing_list' },
        { type: 'ohbl' },
      ];

      // insert doc
      queryQueue.push(createResolvedChain([mockDoc]));
      // select all docs for process
      queryQueue.push(createResolvedChain(allDocs));
      // select current process status
      queryQueue.push(createResolvedChain([{ status: 'draft' }]));
      // update process status
      queryQueue.push(createResolvedChain(undefined));
      // update followUpTracking
      queryQueue.push(createResolvedChain(undefined));
      // select processCode for alert
      queryQueue.push(createResolvedChain([{ processCode: 'IMP-001' }]));

      const result = await documentService.upload(1, 'ohbl', mockFile, 1);

      expect(result).toEqual(mockDoc);
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  describe('getByProcess()', () => {
    it('should return all documents for a process', async () => {
      const mockDocs = [
        { id: 1, processId: 1, type: 'invoice' },
        { id: 2, processId: 1, type: 'packing_list' },
      ];

      queryQueue.push(createResolvedChain(mockDocs));

      const result = await documentService.getByProcess(1);

      expect(result).toEqual(mockDocs);
      expect(result).toHaveLength(2);
    });
  });

  describe('delete()', () => {
    it('should remove file and DB record', async () => {
      const mockDoc = {
        id: 1,
        processId: 1,
        storagePath: '/tmp/test.pdf',
        originalFilename: 'test.pdf',
      };

      // select doc
      queryQueue.push(createResolvedChain([mockDoc]));
      // delete doc
      queryQueue.push(createResolvedChain(undefined));

      const result = await documentService.delete(1, 2);

      expect(result).toEqual({ id: 1 });
      expect(mockFsUnlink).toHaveBeenCalledWith('/tmp/test.pdf');
      expect(auditService.log).toHaveBeenCalledWith(
        2,
        'delete',
        'document',
        1,
        expect.objectContaining({ processId: 1 }),
        null,
      );
    });
  });

  describe('extractText()', () => {
    it('should handle PDF files', async () => {
      const result = await documentService.extractText('/tmp/test.pdf', 'application/pdf');

      expect(result).toBe('Extracted PDF text');
    });

    it('should handle Excel files', async () => {
      const result = await documentService.extractText(
        '/tmp/test.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );

      expect(result).toContain('col1,col2');
    });
  });
});
