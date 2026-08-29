import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';
import { inspectSql } from '../../../__tests__/helpers/sql-inspect.js';

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

    // Recusa do canal NAO carimba a chave de ordenacao da fila. Carimbar aqui
    // reembaralhava a prioridade a cada passada sem nada ter sido tentado.
    expect(patch.lastDeliveryAttemptAt).toBeUndefined();

    // E so preenche o motivo quando ainda nao ha um: `coalesce` protege a falha
    // real de transporte de ser apagada pelo estado do canal.
    const motivo = inspectSql(patch.lastDeliveryError);
    expect(motivo.text.toLowerCase()).toContain('coalesce');
    expect(motivo.params.some((p) => String(p).match(/cooldown/i))).toBe(true);
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
    expect(patch.lastDeliveryAttemptAt).toBeUndefined();
    const motivo = inspectSql(patch.lastDeliveryError);
    expect(motivo.text.toLowerCase()).toContain('coalesce');
    expect(motivo.params.some((p) => String(p).match(/nao configurado/i))).toBe(true);
  });

  /**
   * O defeito que este teste tranca foi MEDIDO em producao em 2026-08-29, uma
   * hora depois do deploy: 3 dos 4 alertas que tinham falha real de transporte
   * estavam com `last_delivery_error` sobrescrito por "Canal em cooldown".
   * A unica pista do webhook quebrado era apagada pela passada seguinte do job.
   */
  it('cooldown NAO apaga a falha real de transporte ja registrada', async () => {
    chat.isChatCooldownActive.mockReturnValue(true);
    const update = createResolvedChain([]);
    queryQueue.push(update);

    await attemptDelivery({ ...baseAlert, deliveryAttempts: 1 });

    const patch = update.set.mock.calls[0][0];
    // Nao e uma string crua: e um coalesce que preserva o que ja estava la.
    expect(typeof patch.lastDeliveryError).not.toBe('string');
    const { text } = inspectSql(patch.lastDeliveryError);
    expect(text.toLowerCase()).toContain('coalesce');
    expect(text).toContain('last_delivery_error');
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

  /**
   * Achado da revisao pos-deploy: o teto e o backoff viviam SO no job de
   * reentrega, e o job nao e o unico chamador. `alertService.create()` tambem
   * chama `attemptDelivery`, no caminho de deduplicacao, e furava as duas
   * protecoes. Como `handleCronError` cria alerta a cada falha de cron, um job
   * quebrado de 5 em 5 minutos gerava ~288 tentativas por dia contra um webhook
   * que ja havia recusado.
   *
   * A regra agora mora dentro de `attemptDelivery`, entao qualquer chamador
   * obedece por construcao — e estes dois casos provam que ela nao so recusa,
   * como recusa SEM ESCREVER: nada de UPDATE, nada de metrica, nada de envio.
   */
  it('TETO: acima do limite nao envia e nao escreve nada', async () => {
    const outcome = await attemptDelivery({
      ...baseAlert,
      deliveryAttempts: MAX_DELIVERY_ATTEMPTS,
      lastDeliveryAttemptAt: null,
    });

    expect(outcome).toEqual({
      delivered: false,
      outcome: 'throttled',
      error: expect.stringMatching(/backoff|teto/i),
    });
    expect(chat.sendToGoogleChat).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(metrics.alertDeliveryTotal.inc).not.toHaveBeenCalled();
  });

  it('BACKOFF: dentro da janela nao envia e nao escreve nada', async () => {
    const outcome = await attemptDelivery({
      ...baseAlert,
      deliveryAttempts: 1,
      lastDeliveryAttemptAt: new Date(), // tentado agora; backoff de 10 min
    });

    expect(outcome.outcome).toBe('throttled');
    expect(chat.sendToGoogleChat).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('alerta recem-criado (zero tentativas) e entregue na hora', async () => {
    queryQueue.push(createResolvedChain([{ value: WEBHOOK }]));
    queryQueue.push(createResolvedChain([]));

    const outcome = await attemptDelivery({
      ...baseAlert,
      deliveryAttempts: 0,
      lastDeliveryAttemptAt: null,
    });

    expect(outcome.delivered).toBe(true);
    expect(chat.sendToGoogleChat).toHaveBeenCalledTimes(1);
  });

  /**
   * O `catch` de `attemptDelivery` nao persistia nada, e a analise inicial parou
   * em "`sendToGoogleChat` nunca lanca, logo nao ha como cair aqui". Verdade
   * sobre o webhook — e incompleta: dentro do mesmo `try` ha outro `await`, o
   * UPDATE que marca a entrega.
   *
   * Cenario: o webhook ACEITA (mensagem ja postada no canal corporativo) e o
   * UPDATE falha por erro transitorio do Postgres. Nada era persistido, a linha
   * seguia com `sent_to_chat = false` e `delivery_attempts = 0`, e a passada
   * seguinte POSTAVA A MESMA MENSAGEM — a cada 5 minutos, pelas 24h da janela,
   * sem nunca alcancar o teto de 5.
   */
  it('entrega confirmada com UPDATE falhando debita tentativa para limitar a duplicacao', async () => {
    chat.sendToGoogleChat.mockResolvedValue(true);
    queryQueue.push(createResolvedChain([{ value: WEBHOOK }]));
    const updateQueFalha = createResolvedChain([]);
    updateQueFalha._setResolveValue(Promise.reject(new Error('57014 canceling statement')));
    queryQueue.push(updateQueFalha);
    const updateDeFallback = createResolvedChain([]);
    queryQueue.push(updateDeFallback);

    const outcome = await attemptDelivery({ ...baseAlert });

    // A mensagem saiu: o resultado tem de dizer isso, sob pena de o chamador
    // reenfileirar achando que nao saiu.
    expect(outcome).toEqual({ delivered: true, outcome: 'sent' });

    // E a tentativa tem de ficar registrada, senao a duplicacao nao tem fim.
    const patch = updateDeFallback.set.mock.calls[0][0];
    expect(patch.deliveryAttempts).toBeDefined();
    expect(patch.sentToChat).toBeUndefined();
  });

  /**
   * O outro lado da mesma regra: falha ANTES do transporte e problema de banco,
   * nao do alerta, e nao pode gastar o orcamento de reentrega dele — cinco
   * blips do Postgres silenciariam o alerta para sempre.
   */
  it('falha ANTES do transporte nao debita tentativa', async () => {
    const selectQueFalha = createResolvedChain([]);
    selectQueFalha._setResolveValue(Promise.reject(new Error('ECONNRESET no pool')));
    queryQueue.push(selectQueFalha);
    const updateDeFallback = createResolvedChain([]);
    queryQueue.push(updateDeFallback);

    const outcome = await attemptDelivery({ ...baseAlert });

    expect(outcome).toEqual({ delivered: false, outcome: 'error' });
    expect(chat.sendToGoogleChat).not.toHaveBeenCalled();
    const patch = updateDeFallback.set.mock.calls[0]?.[0];
    expect(patch?.deliveryAttempts).toBeUndefined();
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
