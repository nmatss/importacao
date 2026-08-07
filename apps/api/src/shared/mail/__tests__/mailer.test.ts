import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetOperationalRecipient = vi.hoisted(() => vi.fn());
const mockSettingsGet = vi.hoisted(() => vi.fn());

vi.mock('../../../modules/settings/operational-recipients.js', () => ({
  getOperationalRecipient: (...args: any[]) => mockGetOperationalRecipient(...args),
  parseEmailList: (value?: string | null) =>
    (value ?? '')
      .split(/[;,\r\n]/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
}));

vi.mock('../../../modules/settings/service.js', () => ({
  settingsService: { get: (...args: any[]) => mockSettingsGet(...args) },
}));

const { buildOutgoingMail, resolveMailFrom, OPERATIONAL_MAILBOX, DEFAULT_MAIL_FROM } =
  await import('../mailer.js');

describe('mailer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettingsGet.mockResolvedValue(undefined);
    mockGetOperationalRecipient.mockResolvedValue('');
    delete process.env.SMTP_FROM;
    delete process.env.SMTP_USER;
    delete process.env.MAIL_FORCE_OPERATIONAL_CC;
  });

  afterEach(() => {
    delete process.env.SMTP_FROM;
    delete process.env.SMTP_USER;
    delete process.env.MAIL_FORCE_OPERATIONAL_CC;
  });

  describe('resolveMailFrom()', () => {
    it('defaults to the operational mailbox', async () => {
      await expect(resolveMailFrom()).resolves.toBe(DEFAULT_MAIL_FROM);
      expect(DEFAULT_MAIL_FROM).toContain(OPERATIONAL_MAILBOX);
    });

    it('never falls back to SMTP_USER, which only authenticates the relay', async () => {
      process.env.SMTP_USER = 'relay-account@grupounico.com';
      await expect(resolveMailFrom()).resolves.toBe(DEFAULT_MAIL_FROM);
    });

    it('prefers the smtp_from setting over the environment', async () => {
      process.env.SMTP_FROM = '"Env" <env@grupounico.com>';
      mockSettingsGet.mockResolvedValue({ key: 'smtp_from', value: 'db@grupounico.com' });
      await expect(resolveMailFrom()).resolves.toBe('db@grupounico.com');
    });

    it('strips CRLF so a configured value cannot inject headers', async () => {
      mockSettingsGet.mockResolvedValue({
        key: 'smtp_from',
        value: 'ok@grupounico.com\r\nBcc: attacker@evil.test',
      });
      await expect(resolveMailFrom()).resolves.toBe('ok@grupounico.comBcc: attacker@evil.test');
    });
  });

  describe('buildOutgoingMail()', () => {
    it('forces the operational mailbox into the mandatory copy', async () => {
      process.env.SMTP_FROM = 'sistema@grupounico.com';
      mockGetOperationalRecipient.mockResolvedValue('ops@grupounico.com');

      const mail = await buildOutgoingMail('cliente@parceiro.com');

      expect(mail.from).toBe('sistema@grupounico.com');
      expect(mail.mandatoryCc).toBe(`ops@grupounico.com, ${OPERATIONAL_MAILBOX}`);
      expect(mail.cc).toBe(`ops@grupounico.com, ${OPERATIONAL_MAILBOX}`);
    });

    it('drops a copy address that is already a primary recipient', async () => {
      process.env.SMTP_FROM = 'sistema@grupounico.com';
      mockGetOperationalRecipient.mockResolvedValue('ops@grupounico.com');

      const mail = await buildOutgoingMail('ops@grupounico.com, cliente@parceiro.com');

      expect(mail.cc).toBe(OPERATIONAL_MAILBOX);
    });

    it('drops the copy when the operational mailbox is also the sender', async () => {
      const mail = await buildOutgoingMail('cliente@parceiro.com');

      expect(mail.from).toBe(DEFAULT_MAIL_FROM);
      expect(mail.cc).toBe('');
      expect(mail.mandatoryCc).toBe(OPERATIONAL_MAILBOX);
    });

    it('keeps the sender in copy when MAIL_FORCE_OPERATIONAL_CC is on', async () => {
      process.env.MAIL_FORCE_OPERATIONAL_CC = 'true';

      const mail = await buildOutgoingMail('cliente@parceiro.com');

      expect(mail.cc).toBe(OPERATIONAL_MAILBOX);
    });

    it('rejects a configured copy address that is not a valid e-mail', async () => {
      mockGetOperationalRecipient.mockResolvedValue('nao-e-email');

      await expect(buildOutgoingMail('cliente@parceiro.com')).rejects.toThrow(
        'Cópia operacional obrigatória inválida',
      );
    });
  });
});
