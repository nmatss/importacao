import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';

const { mockDb, queryQueue } = createMockDb();

vi.mock('../../../shared/database/connection.js', () => ({ db: mockDb }));

const chat = vi.hoisted(() => ({
  sendToGoogleChat: vi.fn(),
  isChatCooldownActive: vi.fn(() => false),
}));
vi.mock('../google-chat.service.js', () => chat);

const metrics = vi.hoisted(() => ({ alertDeliveryTotal: { inc: vi.fn() } }));
vi.mock('../../../shared/metrics/index.js', () => metrics);

vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  attemptDelivery,
  getChatDeliverySummary,
  isUsableWebhookUrl,
  resolveGoogleChatWebhook,
  MAX_DELIVERY_ATTEMPTS,
} = await import('../delivery.service.js');

const WEBHOOK = 'https://chat.googleapis.com/v1/spaces/AAA/messages?key=k&token=t';
const ENV_WEBHOOK = 'https://chat.googleapis.com/v1/spaces/ENV/messages?key=k&token=t';

const baseAlert = {
  id: 42,
  processId: null,
  severity: 'critical',
  title: 'Falha no job: sydle-sync',
  message: 'falhou de novo',
  deliveryAttempts: 0,
};

const envAntes = process.env.GOOGLE_CHAT_WEBHOOK_URL;

beforeEach(() => {
  vi.clearAllMocks();
  queryQueue.length = 0;
  chat.isChatCooldownActive.mockReturnValue(false);
  chat.sendToGoogleChat.mockResolvedValue(true);
  delete process.env.GOOGLE_CHAT_WEBHOOK_URL;
});

afterEach(() => {
  if (envAntes === undefined) delete process.env.GOOGLE_CHAT_WEBHOOK_URL;
  else process.env.GOOGLE_CHAT_WEBHOOK_URL = envAntes;
});

describe('resolveGoogleChatWebhook()', () => {
  it('prefere systemSettings ao env — a mesma ordem que a entrega usa', async () => {
    process.env.GOOGLE_CHAT_WEBHOOK_URL = ENV_WEBHOOK;
    queryQueue.push(createResolvedChain([{ key: 'google_chat_webhook_url', value: WEBHOOK }]));

    await expect(resolveGoogleChatWebhook()).resolves.toEqual({
      url: WEBHOOK,
      source: 'database',
    });
  });

  it('aceita o formato objeto { url } guardado no banco', async () => {
    queryQueue.push(
      createResolvedChain([{ key: 'google_chat_webhook_url', value: { url: WEBHOOK } }]),
    );

    await expect(resolveGoogleChatWebhook()).resolves.toEqual({
      url: WEBHOOK,
      source: 'database',
    });
  });

  it('cai para o env quando o banco esta vazio', async () => {
    process.env.GOOGLE_CHAT_WEBHOOK_URL = ENV_WEBHOOK;
    queryQueue.push(createResolvedChain([{ key: 'google_chat_webhook_url', value: '   ' }]));

    await expect(resolveGoogleChatWebhook()).resolves.toEqual({
      url: ENV_WEBHOOK,
      source: 'env',
    });
  });

  it('devolve nulo quando nao ha webhook em lugar nenhum', async () => {
    queryQueue.push(createResolvedChain([]));

    await expect(resolveGoogleChatWebhook()).resolves.toEqual({ url: null, source: null });
  });
});

describe('isUsableWebhookUrl()', () => {
  it('aceita https e recusa lixo', () => {
    expect(isUsableWebhookUrl(WEBHOOK)).toBe(true);
    expect(isUsableWebhookUrl('http://chat.googleapis.com/v1')).toBe(false);
    expect(isUsableWebhookUrl('cole-aqui-o-webhook')).toBe(false);
    expect(isUsableWebhookUrl(null)).toBe(false);
  });
});

describe('attemptDelivery()', () => {
  it('marca entregue quando o canal aceita', async () => {
    queryQueue.push(createResolvedChain([{ value: WEBHOOK }]));
    const update = createResolvedChain([]);
    queryQueue.push(update);

    const outcome = await attemptDelivery({ ...baseAlert });

    expect(outcome).toEqual({ delivered: true, outcome: 'sent' });
    expect(chat.sendToGoogleChat).toHaveBeenCalledWith(
      WEBHOOK,
      expect.objectContaining({ id: 42 }),
    );
    const patch = update.set.mock.calls[0][0];
    expect(patch.sentToChat).toBe(true);
    expect(patch.sentAt).toBeInstanceOf(Date);
    expect(patch.lastDeliveryError).toBeNull();
  });

  it('COOLDOWN: nao envia, nao marca entregue e nao consome tentativa', async () => {
    chat.isChatCooldownActive.mockReturnValue(true);
    const update = createResolvedChain([]);
    queryQueue.push(update);

    const outcome = await attemptDelivery({ ...baseAlert });

    expect(outcome.delivered).toBe(false);
    expect(outcome.outcome).toBe('cooldown');
    expect(chat.sendToGoogleChat).not.toHaveBeenCalled();

    // O alerta tem que continuar elegivel ao job de reentrega: nada de
    // `sentToChat`, e a tentativa nao pode ser debitada do teto.
    const patch = update.set.mock.calls[0][0];
    expect(patch.sentToChat).toBeUndefined();
    expect(patch.deliveryAttempts).toBeUndefined();
    expect(patch.lastDeliveryError).toMatch(/cooldown/i);
    expect(patch.lastDeliveryAttemptAt).toBeInstanceOf(Date);
    expect(metrics.alertDeliveryTotal.inc).toHaveBeenCalledWith({
      channel: 'google_chat',
      outcome: 'cooldown',
    });
  });

  it('sem webhook: registra o motivo sem consumir tentativa', async () => {
    queryQueue.push(createResolvedChain([]));
    const update = createResolvedChain([]);
    queryQueue.push(update);

    const outcome = await attemptDelivery({ ...baseAlert });

    expect(outcome.outcome).toBe('unconfigured');
    const patch = update.set.mock.calls[0][0];
    expect(patch.sentToChat).toBeUndefined();
    expect(patch.deliveryAttempts).toBeUndefined();
    expect(patch.lastDeliveryError).toMatch(/nao configurado/i);
  });

  it('falha de transporte consome tentativa e deixa o motivo gravado', async () => {
    chat.sendToGoogleChat.mockResolvedValue(false);
    queryQueue.push(createResolvedChain([{ value: WEBHOOK }]));
    const update = createResolvedChain([]);
    queryQueue.push(update);

    const outcome = await attemptDelivery({ ...baseAlert, deliveryAttempts: 1 });

    expect(outcome.outcome).toBe('failed');
    const patch = update.set.mock.calls[0][0];
    expect(patch.sentToChat).toBeUndefined();
    expect(patch.deliveryAttempts).toBeDefined();
    expect(patch.lastDeliveryError).toContain('Falha ao entregar no Google Chat');
    expect(patch.lastDeliveryError).not.toContain('teto');
  });

  it('avisa no ultimo erro quando o teto de tentativas se fecha', async () => {
    chat.sendToGoogleChat.mockResolvedValue(false);
    queryQueue.push(createResolvedChain([{ value: WEBHOOK }]));
    const update = createResolvedChain([]);
    queryQueue.push(update);

    await attemptDelivery({ ...baseAlert, deliveryAttempts: MAX_DELIVERY_ATTEMPTS - 1 });

    expect(update.set.mock.calls[0][0].lastDeliveryError).toContain(
      `teto de ${MAX_DELIVERY_ATTEMPTS} tentativas`,
    );
  });

  it('nao propaga erro do canal — o alerta fica para a proxima passada', async () => {
    chat.sendToGoogleChat.mockRejectedValue(new Error('socket hang up'));
    queryQueue.push(createResolvedChain([{ value: WEBHOOK }]));

    await expect(attemptDelivery({ ...baseAlert })).resolves.toEqual({
      delivered: false,
      outcome: 'error',
    });
  });
});

describe('getChatDeliverySummary()', () => {
  it('devolve a ultima entrega e os pendentes de 24h', async () => {
    queryQueue.push(
      createResolvedChain([{ lastSentAt: '2026-08-29T10:00:00.000Z', pendentes24h: '7' }]),
    );

    await expect(getChatDeliverySummary()).resolves.toEqual({
      lastSentAt: new Date('2026-08-29T10:00:00.000Z'),
      pendentes24h: 7,
    });
  });

  it('tabela vazia nao vira NaN nem data invalida', async () => {
    queryQueue.push(createResolvedChain([{ lastSentAt: null, pendentes24h: '0' }]));

    await expect(getChatDeliverySummary()).resolves.toEqual({
      lastSentAt: null,
      pendentes24h: 0,
    });
  });
});
