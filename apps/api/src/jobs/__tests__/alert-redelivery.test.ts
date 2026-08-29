import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDb, createResolvedChain } from '../../__tests__/helpers/mock-db.js';
import { inspectSql } from '../../__tests__/helpers/sql-inspect.js';

const { mockDb, queryQueue } = createMockDb();

vi.mock('../../shared/database/connection.js', () => ({ db: mockDb }));

const delivery = vi.hoisted(() => ({
  attemptDelivery: vi.fn(async () => ({ delivered: true, outcome: 'sent' as const })),
  MAX_DELIVERY_ATTEMPTS: 5,
}));
// So `attemptDelivery` e dublado. `isDueForRetry` e `backoffMinutes` continuam
// sendo os reais: sao a regra sob teste aqui, e desde que passaram a morar em
// `delivery.service.js` um mock total delas testaria o proprio mock.
vi.mock('../../modules/alerts/delivery.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../modules/alerts/delivery.service.js')>();
  return { ...actual, ...delivery };
});

const chat = vi.hoisted(() => ({ isChatCooldownActive: vi.fn(() => false) }));
vi.mock('../../modules/alerts/google-chat.service.js', () => chat);

vi.mock('../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { runAlertRedelivery, isDueForRetry, backoffMinutes, REDELIVERY_BATCH_SIZE } =
  await import('../alert-redelivery.js');

const MAX = delivery.MAX_DELIVERY_ATTEMPTS;
const MINUTO = 60_000;

function pendente(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    processId: null,
    severity: 'critical',
    title: 'Falha no job: sydle-sync',
    message: 'falhou',
    deliveryAttempts: 0,
    lastDeliveryAttemptAt: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  queryQueue.length = 0;
  chat.isChatCooldownActive.mockReturnValue(false);
});

describe('isDueForRetry()', () => {
  const agora = new Date('2026-08-29T12:00:00Z').getTime();

  it('alerta nunca tentado entra na primeira passada', () => {
    expect(isDueForRetry(pendente(), agora)).toBe(true);
  });

  it('BACKOFF: respeita last_delivery_attempt_at', () => {
    const recente = new Date(agora - 1 * MINUTO);
    expect(isDueForRetry({ deliveryAttempts: 1, lastDeliveryAttemptAt: recente }, agora)).toBe(
      false,
    );

    const antigo = new Date(agora - 11 * MINUTO);
    expect(isDueForRetry({ deliveryAttempts: 1, lastDeliveryAttemptAt: antigo }, agora)).toBe(true);
  });

  it('BACKOFF cresce a cada tentativa', () => {
    expect(backoffMinutes(0)).toBe(5);
    expect(backoffMinutes(1)).toBe(10);
    expect(backoffMinutes(4)).toBe(80);
    // teto no expoente: nao cresce indefinidamente
    expect(backoffMinutes(50)).toBe(80);

    const seisMinutos = new Date(agora - 6 * MINUTO);
    // com 0 tentativas 6min ja passou do backoff de 5min...
    expect(isDueForRetry({ deliveryAttempts: 0, lastDeliveryAttemptAt: seisMinutos }, agora)).toBe(
      true,
    );
    // ...com 1 tentativa, ainda nao (backoff de 10min).
    expect(isDueForRetry({ deliveryAttempts: 1, lastDeliveryAttemptAt: seisMinutos }, agora)).toBe(
      false,
    );
  });

  it('TETO: para de tentar quando estoura o limite de tentativas', () => {
    const antigo = new Date(agora - 10 * 24 * 60 * MINUTO);
    expect(isDueForRetry({ deliveryAttempts: MAX - 1, lastDeliveryAttemptAt: antigo }, agora)).toBe(
      true,
    );
    expect(isDueForRetry({ deliveryAttempts: MAX, lastDeliveryAttemptAt: antigo }, agora)).toBe(
      false,
    );
    expect(isDueForRetry({ deliveryAttempts: MAX + 3, lastDeliveryAttemptAt: null }, agora)).toBe(
      false,
    );
  });
});

describe('runAlertRedelivery()', () => {
  it('retenta o alerta que nao foi entregue', async () => {
    const row = pendente({ id: 77 });
    queryQueue.push(createResolvedChain([row]));

    const res = await runAlertRedelivery();

    expect(delivery.attemptDelivery).toHaveBeenCalledTimes(1);
    expect(delivery.attemptDelivery).toHaveBeenCalledWith(row);
    expect(res).toEqual({ scanned: 1, delivered: 1, failed: 0, aguardando: 0 });
  });

  it('so varre alerta NAO entregue, warning/critical, dentro da janela e abaixo do teto', async () => {
    queryQueue.push(createResolvedChain([]));

    await runAlertRedelivery();

    const where = mockDb.select.mock.results[0].value.where.mock.calls[0][0];
    const { text, params } = inspectSql(where);

    expect(text).toContain('"sent_to_chat"');
    expect(params).toContain(false);
    expect(text).toContain('"severity"');
    expect(params).toContain('warning');
    expect(params).toContain('critical');
    expect(params).not.toContain('info');
    expect(text).toContain("INTERVAL '1 hour'");
    expect(params).toContain(24);
    expect(text).toContain('"delivery_attempts" <');
    expect(params).toContain(MAX);

    // LIMIT explicito: a base tem milhares de linhas historicas.
    expect(mockDb.select.mock.results[0].value.limit).toHaveBeenCalledWith(REDELIVERY_BATCH_SIZE);
  });

  it('nao tenta o alerta que ainda esta em backoff', async () => {
    queryQueue.push(
      createResolvedChain([
        pendente({ id: 1, deliveryAttempts: 1, lastDeliveryAttemptAt: new Date() }),
      ]),
    );

    const res = await runAlertRedelivery();

    expect(delivery.attemptDelivery).not.toHaveBeenCalled();
    expect(res).toEqual({ scanned: 1, delivered: 0, failed: 0, aguardando: 1 });
  });

  it('nao tenta o alerta que ja estourou o teto de tentativas', async () => {
    queryQueue.push(
      createResolvedChain([
        pendente({ id: 2, deliveryAttempts: MAX, lastDeliveryAttemptAt: new Date(0) }),
      ]),
    );

    const res = await runAlertRedelivery();

    expect(delivery.attemptDelivery).not.toHaveBeenCalled();
    expect(res.aguardando).toBe(1);
  });

  /**
   * Medido em producao em 2026-08-29: 11 ciclos em 55 min, ~275 UPDATEs de
   * no-op, zero entregas. Com o breaker aberto nada pode ser entregue, entao a
   * passada inteira e trabalho perdido — e pior que perdido, porque cada no-op
   * mexia na coluna que ordena a fila.
   */
  it('COOLDOWN: nao varre nem escreve nada enquanto o canal esta pausado', async () => {
    chat.isChatCooldownActive.mockReturnValue(true);

    const res = await runAlertRedelivery();

    expect(mockDb.select).not.toHaveBeenCalled();
    expect(delivery.attemptDelivery).not.toHaveBeenCalled();
    expect(res).toEqual({
      scanned: 0,
      delivered: 0,
      failed: 0,
      aguardando: 0,
      skipped: 'cooldown',
    });
  });

  /**
   * `node-cron` nao serializa execucoes: passada que demora mais que o periodo
   * dispara junto com a proxima. Com lote de 25 e timeout de 10s por chamada ao
   * webhook, o pior caso e ~250s contra os 300s do intervalo. Duas passadas
   * simultaneas leem a MESMA linha — o SELECT nao tem FOR UPDATE/SKIP LOCKED e
   * `sent_to_chat` so muda depois do POST — e a mesma mensagem vai duas vezes
   * para o canal corporativo.
   *
   * Mesmo idioma de `email-check.ts`, que roda de 5 em 5 minutos como este.
   */
  it('CONCORRENCIA: passada sobreposta e recusada em vez de duplicar a entrega', async () => {
    let liberar!: () => void;
    const emVoo = new Promise<void>((r) => {
      liberar = r;
    });
    delivery.attemptDelivery.mockImplementation(async () => {
      await emVoo;
      return { delivered: true, outcome: 'sent' as const };
    });

    queryQueue.push(createResolvedChain([pendente({ id: 77 })]));
    queryQueue.push(createResolvedChain([pendente({ id: 77 })]));

    const primeira = runAlertRedelivery();
    const segunda = await runAlertRedelivery(); // entra com a primeira em voo

    expect(segunda).toEqual({
      scanned: 0,
      delivered: 0,
      failed: 0,
      aguardando: 0,
      skipped: 'running',
    });

    liberar();
    await primeira;

    // O alerta foi entregue UMA vez, nao duas.
    expect(delivery.attemptDelivery).toHaveBeenCalledTimes(1);
  });

  it('o latch e liberado mesmo quando a passada falha', async () => {
    const chainQueFalha = createResolvedChain([]);
    chainQueFalha._setResolveValue(Promise.reject(new Error('PG fora do ar')));
    queryQueue.push(chainQueFalha);

    await expect(runAlertRedelivery()).rejects.toThrow('PG fora do ar');

    // Sem o `finally`, o job ficaria travado para sempre depois de um erro.
    queryQueue.push(createResolvedChain([]));
    await expect(runAlertRedelivery()).resolves.toMatchObject({ scanned: 0 });
  });

  it('contabiliza a falha sem interromper o lote', async () => {
    delivery.attemptDelivery
      .mockResolvedValueOnce({ delivered: false, outcome: 'failed' as any })
      .mockResolvedValueOnce({ delivered: true, outcome: 'sent' });
    queryQueue.push(createResolvedChain([pendente({ id: 1 }), pendente({ id: 2 })]));

    const res = await runAlertRedelivery();

    expect(delivery.attemptDelivery).toHaveBeenCalledTimes(2);
    expect(res).toEqual({ scanned: 2, delivered: 1, failed: 1, aguardando: 0 });
  });
});
