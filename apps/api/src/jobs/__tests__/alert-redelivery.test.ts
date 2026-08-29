import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDb, createResolvedChain } from '../../__tests__/helpers/mock-db.js';
import { inspectSql } from '../../__tests__/helpers/sql-inspect.js';

const { mockDb, queryQueue } = createMockDb();

vi.mock('../../shared/database/connection.js', () => ({ db: mockDb }));

const delivery = vi.hoisted(() => ({
  attemptDelivery: vi.fn(async () => ({ delivered: true, outcome: 'sent' as const })),
  MAX_DELIVERY_ATTEMPTS: 5,
}));
vi.mock('../../modules/alerts/delivery.service.js', () => delivery);

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
