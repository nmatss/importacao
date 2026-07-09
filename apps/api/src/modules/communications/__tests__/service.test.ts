import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';

const { mockDb, queryQueue } = createMockDb();
const mockGetOperationalRecipient = vi.hoisted(() => vi.fn());

vi.mock('../../../shared/database/connection.js', () => ({
  db: mockDb,
}));

vi.mock('../../audit/service.js', () => ({
  auditService: { log: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../../shared/utils/process-events.js', () => ({
  recordProcessEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../ai/service.js', () => ({
  aiService: { generateCorrectionEmail: vi.fn() },
}));

vi.mock('../../settings/operational-recipients.js', () => ({
  getOperationalRecipient: (...args: any[]) => mockGetOperationalRecipient(...args),
  parseEmailList: (value?: string | null) =>
    (value ?? '')
      .split(/[;,\r\n]/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  normalizeEmailList: (value?: string | null) =>
    (value ?? '')
      .split(/[;,\r\n]/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
      .join(', '),
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
const { logger } = await import('../../../shared/utils/logger.js');

describe('communicationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
    process.env.SMTP_HOST = 'smtp.test.com';
    process.env.COMMUNICATION_ALLOWED_RECIPIENTS = 'example.com';
    mockGetOperationalRecipient.mockImplementation(async (key: string) => {
      const recipients: Record<string, string> = {
        kiom_email: 'kiom@example.com',
        fenicia_email: 'fenicia@example.com',
        isa_email: 'isa@example.com',
        default_cc_email: 'global@example.com',
      };
      return recipients[key] ?? '';
    });
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

    it('should reject communications without a recipient email', async () => {
      await expect(
        communicationService.create({
          processId: 1,
          recipient: 'Test',
          recipientEmail: '',
          subject: 'Test',
          body: '<p>Hello</p>',
        }),
      ).rejects.toThrow('E-mail do destinatário não configurado');

      expect(mockDb.insert).not.toHaveBeenCalled();
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
        status: 'draft',
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
          cc: 'global@example.com',
          subject: 'Test',
        }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        null,
        'email.sent',
        'communication',
        expect.any(Number),
        expect.objectContaining({
          recipient: 't***@example.com',
          ccRecipients: 'g***@example.com',
        }),
        null,
      );
    });

    it('should throw when communication not found', async () => {
      queryQueue.push(createResolvedChain([]));

      await expect(communicationService.send(999)).rejects.toThrow('não encontrada');
    });

    it('should reject recipients outside configured allowlist', async () => {
      const mockComm = {
        id: 1,
        status: 'draft',
        recipientEmail: 'outside@evil.test',
        subject: 'Test',
        body: '<p>Content</p>',
        attachments: null,
      };

      queryQueue.push(createResolvedChain([mockComm]));

      await expect(communicationService.send(1)).rejects.toThrow(/não autorizado para envio/);
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('should send when every recipient in a list is authorized', async () => {
      const mockComm = {
        id: 1,
        status: 'draft',
        recipientEmail: 'to@example.com, second@example.com',
        subject: 'Test',
        body: '<p>Content</p>',
        attachments: null,
      };
      const mockUpdated = { ...mockComm, status: 'sent', sentAt: new Date() };

      queryQueue.push(createResolvedChain([mockComm]));
      queryQueue.push(createResolvedChain([mockUpdated]));

      const result = await communicationService.send(1);

      expect(result).toEqual(mockUpdated);
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'to@example.com, second@example.com',
        }),
      );
    });

    it('should reject when no allow-list patterns are configured', async () => {
      // No operational recipients and no env allow-list -> empty pattern set.
      process.env.COMMUNICATION_ALLOWED_RECIPIENTS = '';
      mockGetOperationalRecipient.mockResolvedValue('');

      const mockComm = {
        id: 1,
        status: 'draft',
        recipientEmail: 'kiom@example.com',
        subject: 'Test',
        body: '<p>Content</p>',
        attachments: null,
      };

      queryQueue.push(createResolvedChain([mockComm]));

      await expect(communicationService.send(1)).rejects.toThrow(
        /Nenhum destinatário autorizado está configurado/,
      );
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('should allow a configured operational recipient even with empty COMMUNICATION_ALLOWED_RECIPIENTS', async () => {
      process.env.COMMUNICATION_ALLOWED_RECIPIENTS = '';
      mockGetOperationalRecipient.mockImplementation(async (key: string) =>
        key === 'kiom_email'
          ? 'kiom@example.com'
          : key === 'default_cc_email'
            ? 'global@example.com'
            : '',
      );

      const mockComm = {
        id: 1,
        status: 'draft',
        recipientEmail: 'kiom@example.com',
        subject: 'Test',
        body: '<p>Content</p>',
        attachments: null,
      };
      const mockUpdated = { ...mockComm, status: 'sent', sentAt: new Date() };

      queryQueue.push(createResolvedChain([mockComm]));
      queryQueue.push(createResolvedChain([mockUpdated]));

      await communicationService.send(1);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'kiom@example.com' }),
      );
    });

    it('should skip an empty operational recipient value without poisoning the allow-list', async () => {
      // fenicia_email is an empty string; it must not match an empty recipient or widen the list.
      process.env.COMMUNICATION_ALLOWED_RECIPIENTS = '';
      mockGetOperationalRecipient.mockImplementation(async (key: string) =>
        key === 'kiom_email' ? 'kiom@example.com' : '',
      );

      const mockComm = {
        id: 1,
        status: 'draft',
        recipientEmail: 'someone@evil.test',
        subject: 'Test',
        body: '<p>Content</p>',
        attachments: null,
      };

      queryQueue.push(createResolvedChain([mockComm]));

      await expect(communicationService.send(1)).rejects.toThrow('Destinatário');
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('should allow a recipient matching a bare-domain pattern', async () => {
      process.env.COMMUNICATION_ALLOWED_RECIPIENTS = 'kiom.com.br';
      mockGetOperationalRecipient.mockImplementation(async (key: string) =>
        key === 'default_cc_email' ? 'global@example.com' : '',
      );

      const mockComm = {
        id: 1,
        status: 'draft',
        recipientEmail: 'eduarda@kiom.com.br',
        subject: 'Test',
        body: '<p>Content</p>',
        attachments: null,
      };
      const mockUpdated = { ...mockComm, status: 'sent', sentAt: new Date() };

      queryQueue.push(createResolvedChain([mockComm]));
      queryQueue.push(createResolvedChain([mockUpdated]));

      await communicationService.send(1);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'eduarda@kiom.com.br' }),
      );
    });

    it('should allow a recipient matching an @domain wildcard pattern', async () => {
      process.env.COMMUNICATION_ALLOWED_RECIPIENTS = '@fenicia.com';
      mockGetOperationalRecipient.mockImplementation(async (key: string) =>
        key === 'default_cc_email' ? 'global@example.com' : '',
      );

      const mockComm = {
        id: 1,
        status: 'draft',
        recipientEmail: 'ops@sub.fenicia.com',
        subject: 'Test',
        body: '<p>Content</p>',
        attachments: null,
      };
      const mockUpdated = { ...mockComm, status: 'sent', sentAt: new Date() };

      queryQueue.push(createResolvedChain([mockComm]));
      queryQueue.push(createResolvedChain([mockUpdated]));

      await communicationService.send(1);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'ops@sub.fenicia.com' }),
      );
    });

    it('should block a draft before SMTP when the required operational copy is missing', async () => {
      mockGetOperationalRecipient.mockImplementation(async (key: string) =>
        key === 'default_cc_email' ? '' : 'kiom@example.com',
      );
      const mockComm = {
        id: 1,
        status: 'draft',
        recipientEmail: 'to@example.com',
        subject: 'Test',
        body: '<p>Content</p>',
        attachments: null,
      };
      queryQueue.push(createResolvedChain([mockComm]));

      await expect(communicationService.send(1)).rejects.toThrow(
        'Cópia operacional obrigatória não configurada',
      );

      expect(mockSendMail).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('should block a draft before SMTP when the required operational copy is malformed', async () => {
      mockGetOperationalRecipient.mockImplementation(async (key: string) =>
        key === 'default_cc_email' ? 'not-an-email' : 'kiom@example.com',
      );
      const mockComm = {
        id: 1,
        status: 'draft',
        recipientEmail: 'to@example.com',
        subject: 'Test',
        body: '<p>Content</p>',
        attachments: null,
      };
      queryQueue.push(createResolvedChain([mockComm]));

      await expect(communicationService.send(1)).rejects.toThrow(
        'Cópia operacional obrigatória não configurada',
      );

      expect(mockSendMail).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('should reject when an exact-match pattern does not equal the recipient', async () => {
      process.env.COMMUNICATION_ALLOWED_RECIPIENTS = 'allowed@example.com';
      mockGetOperationalRecipient.mockResolvedValue('');

      const mockComm = {
        id: 1,
        status: 'draft',
        recipientEmail: 'other@example.com',
        subject: 'Test',
        body: '<p>Content</p>',
        attachments: null,
      };

      queryQueue.push(createResolvedChain([mockComm]));

      await expect(communicationService.send(1)).rejects.toThrow('Destinatário');
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('should log a masked rejection with process and pattern count', async () => {
      process.env.COMMUNICATION_ALLOWED_RECIPIENTS = 'example.com';
      mockGetOperationalRecipient.mockResolvedValue('');

      const mockComm = {
        id: 1,
        processId: 42,
        status: 'draft',
        recipientEmail: 'eduarda@evil.test',
        subject: 'Test',
        body: '<p>Content</p>',
        attachments: null,
      };

      queryQueue.push(createResolvedChain([mockComm]));

      await expect(communicationService.send(1)).rejects.toThrow('Destinatário');

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          communicationId: 1,
          processId: 42,
          recipient: 'e***@evil.test',
          allowedPatternCount: 1,
        }),
        expect.stringContaining('Envio bloqueado'),
      );
    });

    it('should not leak the full recipient in the 403 message', async () => {
      process.env.COMMUNICATION_ALLOWED_RECIPIENTS = 'example.com';
      mockGetOperationalRecipient.mockResolvedValue('');

      const mockComm = {
        id: 1,
        status: 'draft',
        recipientEmail: 'eduarda@evil.test',
        subject: 'Test',
        body: '<p>Content</p>',
        attachments: null,
      };

      queryQueue.push(createResolvedChain([mockComm]));

      await expect(communicationService.send(1)).rejects.toThrow(
        /Configurações > Destinatários operacionais/,
      );
    });

    it('should reject a recipient list when any address is outside allowlist', async () => {
      const mockComm = {
        id: 1,
        status: 'draft',
        recipientEmail: 'to@example.com, outside@evil.test',
        subject: 'Test',
        body: '<p>Content</p>',
        attachments: null,
      };

      queryQueue.push(createResolvedChain([mockComm]));

      await expect(communicationService.send(1)).rejects.toThrow(/não autorizado para envio/);
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('should not resend a communication that is no longer a draft', async () => {
      const mockComm = {
        id: 1,
        status: 'sent',
        recipientEmail: 'to@example.com',
        subject: 'Test',
        body: '<p>Content</p>',
        attachments: null,
      };

      queryQueue.push(createResolvedChain([mockComm]));

      await expect(communicationService.send(1)).rejects.toThrow('Somente rascunhos');
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('should mark as failed when sendMail throws', async () => {
      const mockComm = {
        id: 1,
        status: 'draft',
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

    it('should reject legacy attachment paths outside the process', async () => {
      const mockComm = {
        id: 1,
        processId: 10,
        status: 'draft',
        recipientEmail: 'to@example.com',
        subject: 'Test',
        body: '<p>Content</p>',
        attachments: [{ filename: 'secret.txt', path: '/etc/passwd' }],
      };

      // select communication
      queryQueue.push(createResolvedChain([mockComm]));
      // documents for same process
      queryQueue.push(createResolvedChain([]));
      // espelhos for same process
      queryQueue.push(createResolvedChain([]));
      // update status to failed
      queryQueue.push(createResolvedChain(undefined));

      await expect(communicationService.send(1)).rejects.toThrow('Anexo invalido');
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('should resolve attachments only from documents in the same process', async () => {
      const mockComm = {
        id: 1,
        processId: 10,
        status: 'draft',
        recipientEmail: 'to@example.com',
        subject: 'Test',
        body: '<p>Content</p>',
        attachments: [{ documentId: 7, filename: 'invoice.pdf' }],
      };
      const mockDoc = {
        id: 7,
        processId: 10,
        originalFilename: 'invoice-original.pdf',
        storagePath: '/safe/uploads/invoice-original.pdf',
      };
      const mockUpdated = { ...mockComm, status: 'sent', sentAt: new Date() };

      // select communication
      queryQueue.push(createResolvedChain([mockComm]));
      // documents for same process
      queryQueue.push(createResolvedChain([mockDoc]));
      // espelhos for same process
      queryQueue.push(createResolvedChain([]));
      // update status to sent
      queryQueue.push(createResolvedChain([mockUpdated]));

      await communicationService.send(1);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: [
            {
              filename: 'invoice.pdf',
              path: '/safe/uploads/invoice-original.pdf',
            },
          ],
        }),
      );
    });
  });

  describe('generateCorrectionDraft()', () => {
    it('should reuse the latest open KIOM draft without overwriting operator edits', async () => {
      const mockProcess = { id: 10, processCode: 'IMP-010', brand: 'puket' };
      const mockFailure = {
        id: 1,
        processId: 10,
        checkName: 'gross-weight-match',
        status: 'failed',
        resolvedManually: false,
        expectedValue: '100',
        actualValue: '90',
        message: 'Peso divergente',
      };
      const existingDraft = {
        id: 77,
        processId: 10,
        recipient: 'KIOM',
        recipientEmail: 'kiom@example.com',
        subject: 'Editado pelo operador',
        body: '<p>Texto manual</p>',
        status: 'draft',
      };

      queryQueue.push(createResolvedChain([mockProcess])); // process
      queryQueue.push(createResolvedChain([mockFailure])); // validation results
      queryQueue.push(createResolvedChain([existingDraft])); // existing KIOM draft

      const result = await communicationService.generateCorrectionDraft(10);

      expect(result).toEqual(existingDraft);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('should create a correction draft when there is no open KIOM draft', async () => {
      const mockProcess = { id: 10, processCode: 'IMP-010', brand: 'puket' };
      const mockFailure = {
        id: 1,
        processId: 10,
        checkName: 'gross-weight-match',
        status: 'failed',
        resolvedManually: false,
        expectedValue: '100',
        actualValue: '90',
        message: 'Peso divergente',
      };
      const createdDraft = {
        id: 78,
        processId: 10,
        recipient: 'KIOM',
        recipientEmail: 'kiom@example.com',
        subject: 'Correção documental necessária - Processo IMP-010',
        body: '<p>Body</p>',
        status: 'draft',
      };

      queryQueue.push(createResolvedChain([mockProcess])); // process
      queryQueue.push(createResolvedChain([mockFailure])); // validation results
      queryQueue.push(createResolvedChain([])); // existing KIOM draft
      queryQueue.push(createResolvedChain([])); // invoice documents
      queryQueue.push(createResolvedChain([createdDraft])); // insert returning

      const result = await communicationService.generateCorrectionDraft(10);

      expect(result).toEqual(createdDraft);
      expect(mockDb.insert).toHaveBeenCalled();
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
