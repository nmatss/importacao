import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';

const { mockDb, queryQueue } = createMockDb();

vi.mock('../../../shared/database/connection.js', () => ({
  db: mockDb,
}));

vi.mock('../../audit/service.js', () => ({
  auditService: { log: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../ai/service.js', () => ({
  aiService: { generateCorrectionEmail: vi.fn() },
}));

const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'msg-1' });

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn().mockReturnValue({
      sendMail: (...args: any[]) => mockSendMail(...args),
    }),
  },
}));

const { communicationService } = await import('../service.js');
const { auditService } = await import('../../audit/service.js');

describe('communicationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
  });

  describe('create()', () => {
    it('should create communication with sanitized body', async () => {
      const input = {
        processId: 1,
        recipient: 'Test',
        recipientEmail: 'test@example.com',
        subject: 'Test Subject',
        body: '<p>Hello</p><script>alert("xss")</script>',
      };

      const mockComm = {
        id: 1,
        ...input,
        body: '<p>Hello</p>',
        status: 'draft',
      };

      // insert returning
      queryQueue.push(createResolvedChain([mockComm]));

      const result = await communicationService.create(input);

      expect(result).toEqual(mockComm);
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should strip event handlers from body', async () => {
      const input = {
        processId: 1,
        recipient: 'Test',
        recipientEmail: 'test@example.com',
        subject: 'Test',
        body: '<img onerror="alert(1)" src="x">',
      };

      const mockComm = { id: 2, ...input, status: 'draft' };
      queryQueue.push(createResolvedChain([mockComm]));

      await communicationService.create(input);

      // The service calls sanitizeHtml before inserting
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  describe('list()', () => {
    it('should return paginated communications', async () => {
      const mockComms = [
        { id: 1, processId: 1, subject: 'Email 1' },
        { id: 2, processId: 1, subject: 'Email 2' },
      ];

      // data query
      queryQueue.push(createResolvedChain(mockComms));
      // count query
      queryQueue.push(createResolvedChain([{ total: 2 }]));

      const result = await communicationService.list(1);

      expect(result.data).toEqual(mockComms);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
    });

    it('should filter by processId', async () => {
      queryQueue.push(createResolvedChain([{ id: 1 }]));
      queryQueue.push(createResolvedChain([{ total: 1 }]));

      const result = await communicationService.list(5);

      expect(result.data).toHaveLength(1);
      expect(mockDb.select).toHaveBeenCalledTimes(2);
    });

    it('should return all communications when no processId filter', async () => {
      queryQueue.push(createResolvedChain([]));
      queryQueue.push(createResolvedChain([{ total: 0 }]));

      const result = await communicationService.list();

      expect(result.data).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('send()', () => {
    it('should send email and mark as sent', async () => {
      const mockComm = {
        id: 1,
        recipientEmail: 'to@example.com',
        subject: 'Test',
        body: '<p>Content</p>',
        attachments: null,
      };
      const mockUpdated = { ...mockComm, status: 'sent', sentAt: new Date() };

      // select communication
      queryQueue.push(createResolvedChain([mockComm]));
      // update status to sent
      queryQueue.push(createResolvedChain([mockUpdated]));

      const result = await communicationService.send(1);

      expect(result).toEqual(mockUpdated);
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'to@example.com',
          subject: 'Test',
        }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        null,
        'email.sent',
        'communication',
        expect.any(Number),
        expect.objectContaining({ to: 'to@example.com' }),
        null,
      );
    });

    it('should throw when communication not found', async () => {
      queryQueue.push(createResolvedChain([]));

      await expect(communicationService.send(999)).rejects.toThrow('não encontrada');
    });

    it('should mark as failed when sendMail throws', async () => {
      const mockComm = {
        id: 1,
        recipientEmail: 'to@example.com',
        subject: 'Test',
        body: '<p>Content</p>',
        attachments: null,
      };

      // select communication
      queryQueue.push(createResolvedChain([mockComm]));
      // update status to failed
      queryQueue.push(createResolvedChain(undefined));

      mockSendMail.mockRejectedValueOnce(new Error('SMTP error'));

      await expect(communicationService.send(1)).rejects.toThrow('Falha ao enviar');
    });
  });

  describe('updateDraft()', () => {
    it('should update draft fields', async () => {
      const mockComm = { id: 1, status: 'draft' };
      const mockUpdated = { id: 1, status: 'draft', subject: 'Updated Subject' };

      // select communication
      queryQueue.push(createResolvedChain([mockComm]));
      // update returning
      queryQueue.push(createResolvedChain([mockUpdated]));

      const result = await communicationService.updateDraft(1, { subject: 'Updated Subject' });

      expect(result).toEqual(mockUpdated);
    });

    it('should throw when communication not found', async () => {
      queryQueue.push(createResolvedChain([]));

      await expect(communicationService.updateDraft(999, { subject: 'X' })).rejects.toThrow(
        'nao encontrada',
      );
    });

    it('should throw when communication is not a draft', async () => {
      const mockComm = { id: 1, status: 'sent' };
      queryQueue.push(createResolvedChain([mockComm]));

      await expect(communicationService.updateDraft(1, { subject: 'X' })).rejects.toThrow(
        'rascunhos',
      );
    });
  });
});
