import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * These tests never touch the Gmail API: `@googleapis/gmail` is mocked whole.
 * What they pin down is the shape of the SEARCH the service is willing to run
 * and the ceilings it applies to one run.
 */

const mockList = vi.hoisted(() => vi.fn());
const mockGet = vi.hoisted(() => vi.fn());
const mockAttachmentsGet = vi.hoisted(() => vi.fn());

vi.mock('@googleapis/gmail', () => ({
  auth: { JWT: class {} },
  gmail_v1: {
    Gmail: class {
      users = {
        messages: {
          list: (...args: any[]) => mockList(...args),
          get: (...args: any[]) => mockGet(...args),
          attachments: { get: (...args: any[]) => mockAttachmentsGet(...args) },
        },
        getProfile: vi.fn(),
      };
    },
  },
}));

vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../shared/utils/google-private-key.js', () => ({
  normalizeGooglePrivateKey: (value?: string) => value ?? '',
}));

const { gmailService, resolveAllowedSenders } = await import('../gmail.service.js');
const { logger } = await import('../../../shared/utils/logger.js');

function base64url(value: string): string {
  return Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

/** One message id per element; `pages` is a list of nextPageToken values. */
function stubMessageList(pages: Array<{ ids: string[]; next?: string }>) {
  let call = 0;
  mockList.mockImplementation(async () => {
    const page = pages[Math.min(call, pages.length - 1)];
    call += 1;
    return {
      data: {
        messages: page.ids.map((id) => ({ id })),
        nextPageToken: page.next ?? null,
      },
    };
  });
}

function stubMessage(attachmentBytes: number) {
  mockGet.mockImplementation(async ({ id }: { id: string }) => ({
    data: {
      payload: {
        headers: [
          { name: 'From', value: 'Fornecedor <ops@kiom.com.br>' },
          { name: 'Subject', value: 'IM0712602NB' },
          { name: 'Message-ID', value: `<${id}@kiom.com.br>` },
        ],
        parts: [
          {
            partId: '1',
            filename: 'invoice.pdf',
            mimeType: 'application/pdf',
            body: { attachmentId: `att-${id}`, size: attachmentBytes },
          },
        ],
      },
    },
  }));
  mockAttachmentsGet.mockImplementation(async () => ({
    data: { data: base64url('x'.repeat(attachmentBytes)), size: attachmentBytes },
  }));
}

describe('gmailService.fetchUnseenEmails() — sender allow-list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_DRIVE_CLIENT_EMAIL = 'sa@example.iam.gserviceaccount.com';
    process.env.GOOGLE_DRIVE_PRIVATE_KEY = 'fake-key';
    process.env.GMAIL_SHARED_MAILBOX = 'shared@example.com';
    // Stubbed so that WITHOUT the fail-closed guard the call would succeed and
    // the assertions below fail on the missing guard, not on a stray TypeError.
    stubMessageList([{ ids: [] }]);
  });

  afterEach(() => {
    delete process.env.EMAIL_ALLOWED_SENDERS;
    delete process.env.GMAIL_MAX_PAGES_PER_RUN;
    delete process.env.GMAIL_MAX_MESSAGES_PER_RUN;
    delete process.env.EMAIL_ATTACHMENT_TOTAL_MAX_BYTES;
  });

  it('FAILS CLOSED without EMAIL_ALLOWED_SENDERS instead of listing the whole mailbox', async () => {
    delete process.env.EMAIL_ALLOWED_SENDERS;

    await expect(gmailService.fetchUnseenEmails()).rejects.toMatchObject({
      code: 'EMAIL_ALLOWED_SENDERS_NOT_CONFIGURED',
    });

    // Nothing was listed, so nothing was downloaded and nothing could be
    // marked as read on a shared corporate mailbox.
    expect(mockList).not.toHaveBeenCalled();
  });

  it('treats a whitespace-only allow-list as unconfigured', async () => {
    process.env.EMAIL_ALLOWED_SENDERS = ' , ,  ';

    await expect(gmailService.fetchUnseenEmails()).rejects.toMatchObject({
      code: 'EMAIL_ALLOWED_SENDERS_NOT_CONFIGURED',
    });
    expect(mockList).not.toHaveBeenCalled();
    expect(resolveAllowedSenders()).toEqual([]);
  });

  it('constrains the query to the configured senders when it is configured', async () => {
    process.env.EMAIL_ALLOWED_SENDERS = 'kiom.com.br, fenicia.com.br';
    stubMessageList([{ ids: [] }]);

    await gmailService.fetchUnseenEmails();

    const query = mockList.mock.calls[0][0].q as string;
    expect(query).toContain('{from:kiom.com.br from:fenicia.com.br}');
    expect(query).toContain('is:unread');
  });

  it('still honours an explicit query override (the callers append the allow-list)', async () => {
    delete process.env.EMAIL_ALLOWED_SENDERS;
    stubMessageList([{ ids: [] }]);

    await gmailService.fetchUnseenEmails(true, 'has:attachment {from:kiom.com.br}');

    expect(mockList.mock.calls[0][0].q).toBe('has:attachment {from:kiom.com.br}');
  });
});

describe('gmailService.fetchUnseenEmails() — per-run ceilings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_DRIVE_CLIENT_EMAIL = 'sa@example.iam.gserviceaccount.com';
    process.env.GOOGLE_DRIVE_PRIVATE_KEY = 'fake-key';
    process.env.EMAIL_ALLOWED_SENDERS = 'kiom.com.br';
  });

  afterEach(() => {
    delete process.env.EMAIL_ALLOWED_SENDERS;
    delete process.env.GMAIL_MAX_PAGES_PER_RUN;
    delete process.env.GMAIL_MAX_MESSAGES_PER_RUN;
    delete process.env.EMAIL_ATTACHMENT_TOTAL_MAX_BYTES;
  });

  it('stops paginating at the page ceiling instead of walking the mailbox forever', async () => {
    process.env.GMAIL_MAX_PAGES_PER_RUN = '2';
    // Every page reports another page: unbounded without the ceiling.
    stubMessageList([{ ids: ['a'], next: 'more' }]);
    stubMessage(1);

    await gmailService.fetchUnseenEmails();

    expect(mockList).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ maxPages: 2 }),
      expect.stringContaining('pagination ceiling'),
    );
  });

  it('caps the number of messages fetched in one run', async () => {
    process.env.GMAIL_MAX_MESSAGES_PER_RUN = '2';
    stubMessageList([{ ids: ['a', 'b', 'c', 'd'] }]);
    stubMessage(1);

    const emails = await gmailService.fetchUnseenEmails();

    expect(emails).toHaveLength(2);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('stops between messages once the aggregate attachment budget is spent', async () => {
    // 3 messages of 100 bytes each against a 150-byte budget: the first two are
    // fetched (the check runs BEFORE each message, never mid-message), the
    // third is left unread for the next run.
    process.env.EMAIL_ATTACHMENT_TOTAL_MAX_BYTES = '150';
    stubMessageList([{ ids: ['a', 'b', 'c'] }]);
    stubMessage(100);

    const emails = await gmailService.fetchUnseenEmails();

    expect(emails).toHaveLength(2);
    expect(emails.every((email) => email.attachments.length === 1)).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ maxTotalBytes: 150 }),
      expect.stringContaining('attachment budget'),
    );
  });
});
