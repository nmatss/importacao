import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetOperationalRecipient = vi.hoisted(() => vi.fn());
const mockSettingsGet = vi.hoisted(() => vi.fn());
const mockSmtpVerify = vi.hoisted(() => vi.fn());
const mockSmtpClose = vi.hoisted(() => vi.fn());
const mockSmtpSendMail = vi.hoisted(() => vi.fn().mockResolvedValue({ messageId: 'x' }));
const mockCreateTransport = vi.hoisted(() =>
  vi.fn(() => ({
    verify: (...args: any[]) => mockSmtpVerify(...args),
    close: (...args: any[]) => mockSmtpClose(...args),
    sendMail: (...args: any[]) => mockSmtpSendMail(...args),
  })),
);

vi.mock('nodemailer', () => ({
  default: {
    createTransport: mockCreateTransport,
  },
}));

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

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  buildOutgoingMail,
  deliverMail,
  isMailDryRun,
  resolveMailFrom,
  resolveSmtpAuthMode,
  verifySmtpConnection,
  getSmtpTransport,
  OPERATIONAL_MAILBOX,
  DEFAULT_MAIL_FROM,
} = await import('../mailer.js');

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

describe('mailer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettingsGet.mockResolvedValue(undefined);
    mockGetOperationalRecipient.mockResolvedValue('');
    delete process.env.SMTP_FROM;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_AUTH_MODE;
    delete process.env.MAIL_DRY_RUN;
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    mockSmtpVerify.mockResolvedValue(true);
  });

  afterEach(() => {
    delete process.env.SMTP_FROM;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_AUTH_MODE;
    delete process.env.MAIL_DRY_RUN;
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
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

    it('rejects CRLF and malformed sender syntax before Nodemailer can reinterpret it', async () => {
      mockSettingsGet.mockResolvedValue({
        key: 'smtp_from',
        value: 'ok@grupounico.com\r\nBcc: attacker@evil.test',
      });
      await expect(resolveMailFrom()).rejects.toMatchObject({ code: 'SMTP_FROM_INVALID' });
    });

    it('rejects RFC-2822 group syntax that could replace the envelope sender', async () => {
      mockSettingsGet.mockResolvedValue({
        key: 'smtp_from',
        value: '"Uni.co" <global@grupounico.com>Bcc: attacker@evil.test',
      });
      await expect(resolveMailFrom()).rejects.toMatchObject({ code: 'SMTP_FROM_INVALID' });
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

    it('keeps the mandatory copy when the operational mailbox is also the sender', async () => {
      const mail = await buildOutgoingMail('cliente@parceiro.com');

      expect(mail.from).toBe(DEFAULT_MAIL_FROM);
      expect(mail.cc).toBe(OPERATIONAL_MAILBOX);
      expect(mail.mandatoryCc).toBe(OPERATIONAL_MAILBOX);
    });

    it('does not let a legacy false flag suppress the mandatory copy', async () => {
      process.env.MAIL_FORCE_OPERATIONAL_CC = 'false';

      const mail = await buildOutgoingMail('cliente@parceiro.com');

      expect(mail.cc).toBe(OPERATIONAL_MAILBOX);
      delete process.env.MAIL_FORCE_OPERATIONAL_CC;
    });

    it('rejects a configured copy address that is not a valid e-mail', async () => {
      mockGetOperationalRecipient.mockResolvedValue('nao-e-email');

      await expect(buildOutgoingMail('cliente@parceiro.com')).rejects.toThrow(
        'Cópia operacional obrigatória inválida',
      );
    });
  });

  describe('verifySmtpConnection()', () => {
    it('fails before opening a transport when SMTP is not configured', async () => {
      await expect(verifySmtpConnection()).rejects.toMatchObject({
        code: 'SMTP_NOT_CONFIGURED',
      });
      expect(mockSmtpVerify).not.toHaveBeenCalled();
    });

    it('verifies and always closes the SMTP transport without sending a message', async () => {
      process.env.SMTP_HOST = 'smtp.test';

      await expect(verifySmtpConnection()).resolves.toBeUndefined();

      expect(mockSmtpVerify).toHaveBeenCalledOnce();
      expect(mockSmtpClose).toHaveBeenCalledOnce();
    });

    it('uses saved host, port and user while keeping the password in the environment', async () => {
      // Auth is now an explicit operator decision, not an inference from
      // SMTP_USER/SMTP_PASS being present.
      process.env.SMTP_AUTH_MODE = 'login';
      process.env.SMTP_PASS = 'secret-not-logged';
      process.env.SMTP_HOST = 'env.invalid';
      mockSettingsGet.mockImplementation(async (key: string) => {
        const values: Record<string, string> = {
          smtp_host: 'smtp.saved.test',
          smtp_port: '465',
          smtp_user: 'relay@example.com',
        };
        return values[key] ? { key, value: values[key] } : undefined;
      });

      await verifySmtpConnection();

      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'smtp.saved.test',
          port: 465,
          auth: { user: 'relay@example.com', pass: 'secret-not-logged' },
        }),
      );
    });
  });

  describe('resolveSmtpAuthMode() / getSmtpTransport()', () => {
    it('defaults to "none": the internal relay authorises by network, not credentials', async () => {
      expect(resolveSmtpAuthMode()).toBe('none');
    });

    it('does not offer AUTH just because a placeholder user and a password exist', async () => {
      // The old rule compared SMTP_USER against ONE hardcoded placeholder, so
      // any other placeholder re-enabled AUTH and earned an EAUTH from the relay.
      process.env.SMTP_HOST = 'relay.interno';
      process.env.SMTP_USER = 'qualquer-outro-placeholder@grupounico.com';
      process.env.SMTP_PASS = 'nao-usada';

      await getSmtpTransport();

      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.not.objectContaining({ auth: expect.anything() }),
      );
    });

    it('offers AUTH only when the operator asks for it explicitly', async () => {
      process.env.SMTP_HOST = 'smtp.gmail.com';
      process.env.SMTP_USER = 'relay@example.com';
      process.env.SMTP_PASS = 'app-password';
      process.env.SMTP_AUTH_MODE = 'login';

      await getSmtpTransport();

      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({ auth: { user: 'relay@example.com', pass: 'app-password' } }),
      );
    });

    it('falls back to "none" on an unrecognised value instead of guessing', async () => {
      process.env.SMTP_AUTH_MODE = 'plaintext';
      expect(resolveSmtpAuthMode()).toBe('none');
    });
  });

  describe('isMailDryRun() / deliverMail()', () => {
    it('is ON by default outside production', () => {
      process.env.NODE_ENV = 'development';
      expect(isMailDryRun()).toBe(true);
      process.env.NODE_ENV = 'test';
      expect(isMailDryRun()).toBe(true);
    });

    it('is OFF by default in production', () => {
      process.env.NODE_ENV = 'production';
      expect(isMailDryRun()).toBe(false);
    });

    it('can be forced in either direction for an authorised SMTP smoke test', () => {
      process.env.NODE_ENV = 'test';
      process.env.MAIL_DRY_RUN = 'false';
      expect(isMailDryRun()).toBe(false);

      process.env.NODE_ENV = 'production';
      process.env.MAIL_DRY_RUN = 'true';
      expect(isMailDryRun()).toBe(true);
    });

    it('does NOT call sendMail while the dry-run gate is on', async () => {
      process.env.NODE_ENV = 'development';
      const transport = { sendMail: mockSmtpSendMail } as any;

      const result = await deliverMail(transport, {
        to: 'operacao@parceiro.com',
        subject: 'Assunto',
      });

      expect(result.delivered).toBe(false);
      expect(mockSmtpSendMail).not.toHaveBeenCalled();
    });

    it('delivers once the gate is explicitly lifted', async () => {
      process.env.NODE_ENV = 'development';
      process.env.MAIL_DRY_RUN = 'false';
      const transport = { sendMail: mockSmtpSendMail } as any;

      const result = await deliverMail(transport, {
        to: 'operacao@parceiro.com',
        subject: 'Assunto',
      });

      expect(result.delivered).toBe(true);
      expect(mockSmtpSendMail).toHaveBeenCalledOnce();
    });
  });
});
