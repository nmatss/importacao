import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const selectMock = vi.fn();

vi.mock('../../../shared/database/connection.js', () => ({
  db: { select: selectMock, insert: vi.fn() },
}));

vi.mock('../../alerts/service.js', () => ({
  alertService: { create: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { dailyWindowStartUtc, monthlyWindowStartUtc, getDailySpendUSD } =
  await import('../cost-tracker.js');

/**
 * `ai_usage_log.created_at` é `timestamp` SEM time zone e o Postgres do
 * compose roda em UTC, então a coluna guarda UTC. A janela comparava esse UTC
 * contra `date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo')`, que é
 * wall-clock de São Paulo: a janela começava na meia-noite local interpretada
 * como UTC, isto é, 21:00 do dia anterior no horário local.
 */
describe('janela de orcamento de IA — uma unica referencia de fuso', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // Instante de referência: 29/08/2026 22:30 em Brasília (UTC-3).
  const nowBrt2230 = new Date('2026-08-30T01:30:00.000Z');

  it('comeca a janela DIARIA na meia-noite local, nao em 21:00 do dia anterior', () => {
    // Meia-noite de 29/08 em Brasília = 29/08 03:00 UTC.
    expect(dailyWindowStartUtc(nowBrt2230).toISOString()).toBe('2026-08-29T03:00:00.000Z');
  });

  it('conta um registro das 22:00 de Brasilia no dia local correto', () => {
    const start = dailyWindowStartUtc(nowBrt2230);

    // 29/08 22:00 BRT — o dia local em curso. Tem de entrar.
    const hoje2200 = new Date('2026-08-30T01:00:00.000Z');
    expect(hoje2200.getTime()).toBeGreaterThanOrEqual(start.getTime());

    // 28/08 22:00 BRT — dia local ANTERIOR. Não pode entrar. Era exatamente o
    // que a janela antiga (>= '2026-08-29 00:00' lido como UTC) incluía.
    const ontem2200 = new Date('2026-08-29T01:00:00.000Z');
    expect(ontem2200.getTime()).toBeLessThan(start.getTime());
  });

  it('nao reseta o teto diario tres horas cedo', () => {
    // 29/08 21:30 BRT: ainda é o dia 29 e a janela não pode ter virado.
    const antesDaMeiaNoiteLocal = new Date('2026-08-30T00:30:00.000Z');
    expect(dailyWindowStartUtc(antesDaMeiaNoiteLocal).toISOString()).toBe(
      '2026-08-29T03:00:00.000Z',
    );

    // 30/08 00:30 BRT: agora sim vira.
    const depoisDaMeiaNoiteLocal = new Date('2026-08-30T03:30:00.000Z');
    expect(dailyWindowStartUtc(depoisDaMeiaNoiteLocal).toISOString()).toBe(
      '2026-08-30T03:00:00.000Z',
    );
  });

  it('comeca a janela MENSAL no primeiro dia do mes local', () => {
    // 31/08 22:30 BRT ainda é agosto, mesmo já sendo 01/09 em UTC.
    const ultimaHoraDeAgosto = new Date('2026-09-01T01:30:00.000Z');
    expect(monthlyWindowStartUtc(ultimaHoraDeAgosto).toISOString()).toBe(
      '2026-08-01T03:00:00.000Z',
    );

    // 31/07 22:00 BRT pertence a julho e fica de fora da janela de agosto.
    const julho2200 = new Date('2026-08-01T01:00:00.000Z');
    expect(julho2200.getTime()).toBeLessThan(monthlyWindowStartUtc(ultimaHoraDeAgosto).getTime());
  });

  it('compara contra um literal UTC, sem depender do TimeZone da sessao do Postgres', async () => {
    vi.setSystemTime(nowBrt2230);
    let captured: unknown;
    selectMock.mockReturnValueOnce({
      from: () => ({
        where: async (condition: unknown) => {
          captured = condition;
          return [{ total: '1.5' }];
        },
      }),
    });

    await expect(getDailySpendUSD()).resolves.toBe(1.5);

    const { PgDialect } = await import('drizzle-orm/pg-core');
    const query = new PgDialect().sqlToQuery(captured as never);

    expect(query.params).toContain('2026-08-29 03:00:00.000');
    // O fuso não sobra em lugar nenhum do SQL: a comparação é UTC contra UTC.
    expect(query.sql).not.toContain('AT TIME ZONE');
    expect(query.sql).not.toContain('date_trunc');
    // A coluna fica sem função em volta — o índice created_at continua servindo.
    expect(query.sql).toContain('"created_at" >= $1::timestamp');
  });
});

describe('titulo do alerta de 80%', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.AI_MONTHLY_BUDGET_USD;
    delete process.env.AI_DAILY_BUDGET_BRL;
  });

  it('usa a data LOCAL, nao a data UTC (as 22:00 BRT marcava o dia seguinte)', async () => {
    vi.setSystemTime(new Date('2026-08-30T01:30:00.000Z')); // 29/08 22:30 BRT
    process.env.AI_MONTHLY_BUDGET_USD = '200';
    process.env.AI_DAILY_BUDGET_BRL = '0';
    selectMock.mockReset();
    selectMock.mockReturnValue({
      from: () => ({ where: async () => [{ total: '180' }] }),
    });

    const { assertBudgetAvailable } = await import('../cost-tracker.js');
    const { alertService } = await import('../../alerts/service.js');

    await assertBudgetAvailable();

    expect(alertService.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining('2026-08-29') }),
    );
  });
});
