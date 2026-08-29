import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The 5-minute cron was the only scan path that did not abort on a missing
 * sender allow-list — `doubleCheckEmails`, `/trigger` and `/history-scan` all
 * did. An empty allow-list turns the Gmail search into
 * `is:unread has:attachment` over a shared corporate mailbox.
 */

const mockProcessNewEmails = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ fetched: 0, processed: 0 }),
);

vi.mock('../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../modules/documents/drive-ingestion.service.js', () => ({
  getDocumentSource: () => 'email',
  isEmailIngestionEnabled: () => true,
}));

vi.mock('../../modules/email-ingestion/processor.js', () => ({
  emailProcessor: { processNewEmails: (...args: any[]) => mockProcessNewEmails(...args) },
}));

const { checkEmails, doubleCheckEmails } = await import('../email-check.js');

describe('checkEmails() — sender allow-list gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EMAIL_INGESTION_ENABLED = 'true';
    process.env.GOOGLE_DRIVE_CLIENT_EMAIL = 'sa@example.iam.gserviceaccount.com';
    process.env.GOOGLE_DRIVE_PRIVATE_KEY = 'fake-key';
  });

  afterEach(() => {
    delete process.env.EMAIL_INGESTION_ENABLED;
    delete process.env.GOOGLE_DRIVE_CLIENT_EMAIL;
    delete process.env.GOOGLE_DRIVE_PRIVATE_KEY;
    delete process.env.EMAIL_ALLOWED_SENDERS;
  });

  it('does not poll the shared mailbox without EMAIL_ALLOWED_SENDERS', async () => {
    delete process.env.EMAIL_ALLOWED_SENDERS;

    await checkEmails();

    expect(mockProcessNewEmails).not.toHaveBeenCalled();
  });

  it('polls normally once the allow-list is configured', async () => {
    process.env.EMAIL_ALLOWED_SENDERS = 'kiom.com.br';

    await checkEmails();

    expect(mockProcessNewEmails).toHaveBeenCalledOnce();
  });

  it('keeps the same gate on the end-of-day double-check', async () => {
    delete process.env.EMAIL_ALLOWED_SENDERS;

    await doubleCheckEmails();

    expect(mockProcessNewEmails).not.toHaveBeenCalled();
  });
});
