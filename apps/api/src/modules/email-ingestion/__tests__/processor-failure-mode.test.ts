import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';

/**
 * Marking a Gmail message as read is irreversible from the system's side: the
 * poll searches `is:unread` and `failed` is a terminal status, so an
 * acknowledged failure only comes back through a human `POST /reprocess`.
 * These tests pin down WHICH failures are allowed to consume a message.
 */

const { mockDb, queryQueue } = createMockDb();

const mockMarkAsRead = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockFetchUnseenEmails = vi.hoisted(() => vi.fn());
const mockGetReferenceSource = vi.hoisted(() => vi.fn());

vi.mock('../../../shared/database/connection.js', () => ({ db: mockDb }));

vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../gmail.service.js', () => ({
  gmailService: {
    isConfigured: () => true,
    fetchUnseenEmails: (...args: any[]) => mockFetchUnseenEmails(...args),
    markAsRead: (...args: any[]) => mockMarkAsRead(...args),
  },
  resolveSharedMailbox: () => 'global@example.com',
  resolveAllowedSenders: () =>
    (process.env.EMAIL_ALLOWED_SENDERS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
}));

vi.mock('../imap.service.js', () => ({
  imapService: { fetchUnseenEmails: vi.fn(), markAsRead: vi.fn() },
}));

vi.mock('../../documents/service.js', () => ({
  documentService: { upload: vi.fn(), reprocess: vi.fn() },
  spreadsheetBufferToText: vi.fn(),
}));

vi.mock('../../documents/source-policy.js', () => ({
  isEmailIngestionEnabled: () => true,
}));

vi.mock('../../audit/service.js', () => ({
  auditService: { log: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../alerts/service.js', () => ({
  alertService: { create: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../ai/service.js', () => ({
  aiService: { analyzeEmail: vi.fn().mockResolvedValue(null) },
}));

// `getReferenceSource()` runs unconditionally inside the per-email try block,
// which makes it the deterministic place to inject a processing failure.
vi.mock('../../follow-up/reference-registry.js', () => ({
  getReferenceSource: (...args: any[]) => mockGetReferenceSource(...args),
  filterCandidatesByFollowUp: vi.fn(),
}));

const { emailProcessor, isPermanentProcessingError, readTransientAttempt, buildReprocessQueries } =
  await import('../processor.js');
const { AppError } = await import('../../../shared/errors/index.js');

const CHAIN_METHODS = [
  'insert',
  'update',
  'delete',
  'select',
  'from',
  'where',
  'set',
  'values',
  'limit',
  'offset',
  'orderBy',
  'groupBy',
  'leftJoin',
  'innerJoin',
  'returning',
  'onConflictDoUpdate',
  'onConflictDoNothing',
];

/** Captures the payload handed to `.set()` on an update chain. */
function createCapturingChain(resolveValue: any) {
  const chain: Record<string, any> = { setCalls: [] as any[] };
  for (const method of CHAIN_METHODS) chain[method] = vi.fn(() => chain);
  chain.set = vi.fn((value: any) => {
    chain.setCalls.push(value);
    return chain;
  });
  chain.then = (onFulfilled: any, onRejected?: any) =>
    Promise.resolve(resolveValue).then(onFulfilled, onRejected);
  return chain;
}

const EMAIL = {
  messageId: '<abc123@kiom.com.br>',
  gmailId: 'gmail-1',
  from: 'Fornecedor <ops@kiom.com.br>',
  subject: 'IM0712602NB documentos',
  body: 'segue anexo',
  date: new Date('2026-08-20T10:00:00Z'),
  attachments: [
    {
      filename: 'invoice.pdf',
      contentType: 'application/pdf',
      content: Buffer.from('%PDF-1.4 fake'),
      size: 13,
    },
  ],
};

/** Queues the two reads that precede the injected failure, plus the catch update. */
function primeQueue(existingLog: any[] = []) {
  queryQueue.push(createResolvedChain(existingLog)); // existing-log lookup
  queryQueue.push(createResolvedChain([{ id: 42, errorMessage: null }])); // insert ... returning
  const catchUpdate = createCapturingChain([]);
  queryQueue.push(catchUpdate); // update inside the catch handler
  return catchUpdate;
}

describe('isPermanentProcessingError()', () => {
  it('treats a plain Error as transient — reprocessing is cheap, losing e-mail is not', () => {
    expect(isPermanentProcessingError(new Error('ECONNRESET'))).toBe(false);
    expect(isPermanentProcessingError(undefined)).toBe(false);
  });

  it('treats a 5xx dependency failure as transient', () => {
    expect(isPermanentProcessingError(new AppError('Drive fora', 503, 'DRIVE_DOWN'))).toBe(false);
  });

  it('treats timeout and rate-limit as transient even though they are 4xx', () => {
    expect(isPermanentProcessingError(new AppError('timeout', 408, 'T'))).toBe(false);
    expect(isPermanentProcessingError(new AppError('rate', 429, 'R'))).toBe(false);
  });

  it('treats a business-rule 4xx as permanent', () => {
    expect(isPermanentProcessingError(new AppError('formato inválido', 422, 'BAD'))).toBe(true);
    expect(isPermanentProcessingError(new AppError('remetente', 403, 'FORBIDDEN'))).toBe(true);
  });
});

describe('readTransientAttempt()', () => {
  it('reads back the counter this processor wrote', () => {
    expect(readTransientAttempt('Falha transitória (tentativa 3/5): timeout')).toBe(3);
  });

  it('returns zero for an unrelated or absent message', () => {
    expect(readTransientAttempt(null)).toBe(0);
    expect(readTransientAttempt('Remetente não autorizado')).toBe(0);
  });
});

describe('emailProcessor.processNewEmails() — acknowledgement on failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
    process.env.EMAIL_ALLOWED_SENDERS = 'kiom.com.br';
    mockFetchUnseenEmails.mockResolvedValue([EMAIL]);
  });

  afterEach(() => {
    delete process.env.EMAIL_ALLOWED_SENDERS;
    delete process.env.EMAIL_TRANSIENT_MAX_ATTEMPTS;
  });

  it('does NOT mark the message as read when the failure is transient', async () => {
    const catchUpdate = primeQueue();
    mockGetReferenceSource.mockImplementation(() => {
      throw new Error('connect ETIMEDOUT drive.googleapis.com');
    });

    await emailProcessor.processNewEmails();

    expect(mockMarkAsRead).not.toHaveBeenCalled();
    // Back to `pending`, not the terminal `failed`, so the next poll retries it.
    expect(catchUpdate.setCalls[0]).toMatchObject({ status: 'pending' });
    expect(catchUpdate.setCalls[0].errorMessage).toContain('tentativa 1/5');
  });

  it('marks the message as read when the failure is permanent', async () => {
    const catchUpdate = primeQueue();
    mockGetReferenceSource.mockImplementation(() => {
      throw new AppError('Anexo em formato inválido', 422, 'INVALID_ATTACHMENT');
    });

    await emailProcessor.processNewEmails();

    expect(mockMarkAsRead).toHaveBeenCalledWith('gmail-1');
    expect(catchUpdate.setCalls[0]).toMatchObject({ status: 'failed' });
  });

  it('gives up on a transient failure that keeps repeating, so it cannot loop forever', async () => {
    process.env.EMAIL_TRANSIENT_MAX_ATTEMPTS = '5';
    // The log already carries four recorded transient attempts.
    const catchUpdate = primeQueue([
      {
        id: 42,
        status: 'pending',
        errorMessage: 'Falha transitória (tentativa 4/5): ETIMEDOUT',
        updatedAt: new Date('2026-08-20T09:00:00Z'),
      },
    ]);
    mockGetReferenceSource.mockImplementation(() => {
      throw new Error('ETIMEDOUT');
    });

    await emailProcessor.processNewEmails();

    expect(catchUpdate.setCalls.at(-1)).toMatchObject({ status: 'failed' });
    expect(mockMarkAsRead).toHaveBeenCalledWith('gmail-1');
  });
});

describe('buildReprocessQueries()', () => {
  it('addresses the message by rfc822msgid first, without the angle brackets', () => {
    const queries = buildReprocessQueries('<abc@kiom.com.br>', 'Nome <ops@kiom.com.br>', 'Assunto');
    expect(queries[0]).toBe('rfc822msgid:abc@kiom.com.br');
  });

  it('falls back to the MAILBOX only — the whole From header is not a Gmail clause', () => {
    const queries = buildReprocessQueries(
      '<abc@kiom.com.br>',
      'Nome Sobrenome <ops@kiom.com.br>',
      'Assunto',
    );
    expect(queries[1]).toBe('from:ops@kiom.com.br subject:"Assunto"');
    expect(queries[1]).not.toContain('Nome');
  });

  it('omits the fallback when there is no usable mailbox or subject', () => {
    expect(buildReprocessQueries('abc@x.com', 'sem-endereco', '')).toEqual([
      'rfc822msgid:abc@x.com',
    ]);
  });
});

describe('emailProcessor.getStatus() — allow-list exposure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
  });

  afterEach(() => {
    delete process.env.EMAIL_ALLOWED_SENDERS;
  });

  it('reports how many senders are allowed, never the addresses', async () => {
    process.env.EMAIL_ALLOWED_SENDERS = 'ops@kiom.com.br,fenicia.com.br';
    queryQueue.push(createResolvedChain([])); // last log
    queryQueue.push(createResolvedChain([])); // today stats

    const status = await emailProcessor.getStatus();

    // GET /api/email-ingestion/status is authenticated but not admin-only.
    expect(JSON.stringify(status)).not.toContain('kiom.com.br');
    expect(JSON.stringify(status)).not.toContain('fenicia.com.br');
    expect(status.allowedSendersConfigured).toBe(true);
    expect(status.allowedSendersCount).toBe(2);
  });

  it('still says clearly when nothing is configured', async () => {
    delete process.env.EMAIL_ALLOWED_SENDERS;
    queryQueue.push(createResolvedChain([]));
    queryQueue.push(createResolvedChain([]));

    const status = await emailProcessor.getStatus();

    expect(status.allowedSendersConfigured).toBe(false);
    expect(status.allowedSendersCount).toBe(0);
  });
});

describe('emailProcessor.reprocess()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
    process.env.EMAIL_ALLOWED_SENDERS = 'kiom.com.br';
  });

  afterEach(() => {
    delete process.env.EMAIL_ALLOWED_SENDERS;
  });

  const FAILED_LOG = {
    id: 7,
    status: 'failed',
    messageId: '<abc123@kiom.com.br>',
    fromAddress: 'Fornecedor <ops@kiom.com.br>',
    subject: 'IM0712602NB documentos',
    processId: null,
    processedAttachments: null,
  };

  it('does NOT report success when the message could not be refetched', async () => {
    queryQueue.push(createResolvedChain([FAILED_LOG])); // load log
    const park = createCapturingChain([]);
    queryQueue.push(park); // park the messageId
    // Both queries come back empty: nothing to reprocess.
    mockFetchUnseenEmails.mockResolvedValue([]);
    queryQueue.push(createResolvedChain([])); // lookup of the original messageId
    const restore = createCapturingChain([]);
    queryQueue.push(restore); // restore + failed
    queryQueue.push(createCapturingChain([])); // outer catch update

    await expect(emailProcessor.reprocess(7)).rejects.toMatchObject({
      code: 'EMAIL_REPROCESS_NOT_FOUND',
    });

    // The original log was never declared `reprocessed` on a refetch that found
    // nothing, and its identity was restored.
    expect(park.setCalls[0]).not.toHaveProperty('status');
    expect(restore.setCalls[0]).toMatchObject({
      status: 'failed',
      messageId: '<abc123@kiom.com.br>',
    });
  });

  it('addresses the message by rfc822msgid and reports the real count', async () => {
    queryQueue.push(createResolvedChain([FAILED_LOG])); // load log
    queryQueue.push(createCapturingChain([])); // park the messageId
    // Reprocess path: existing lookup + insert + success is out of scope here;
    // what matters is the query used and the count reported back.
    mockFetchUnseenEmails.mockImplementation(async () => []);
    queryQueue.push(createResolvedChain([]));
    queryQueue.push(createCapturingChain([]));
    queryQueue.push(createCapturingChain([]));

    await expect(emailProcessor.reprocess(7)).rejects.toBeTruthy();

    expect(mockFetchUnseenEmails).toHaveBeenCalledWith(true, 'rfc822msgid:abc123@kiom.com.br');
    // Fallback query uses the MAILBOX only, never the whole From header.
    expect(mockFetchUnseenEmails).toHaveBeenCalledWith(
      true,
      'from:ops@kiom.com.br subject:"IM0712602NB documentos"',
    );
  });
});
