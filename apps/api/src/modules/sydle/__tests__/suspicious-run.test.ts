import { describe, it, expect, vi, beforeEach } from 'vitest';

const alertMocks = vi.hoisted(() => ({ create: vi.fn().mockResolvedValue(undefined) }));

vi.mock('../../alerts/service.js', () => ({ alertService: alertMocks }));
vi.mock('../../../shared/database/connection.js', () => ({ db: { select: vi.fn() } }));
vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../audit/service.js', () => ({ auditService: { log: vi.fn() } }));

const { sydleService } = await import('../service.js');

/**
 * Falha DURA do sync ja era coberta: `handleCronError` cria alerta critical
 * para qualquer excecao de cron. A lacuna era o SUCESSO VAZIO — uma mudanca
 * de nome de campo ou de envelope de paginacao do lado do SYDLE produzia
 * `status: 'success'`, `fetched: 0`, sem alerta e sem erro. A tela financeira
 * congelava nos dados antigos e nada indicava isso.
 */
describe('sydleService.warnOnSuspiciousRun', () => {
  beforeEach(() => {
    alertMocks.create.mockClear();
  });

  it('alerta quando o run traz ZERO logo depois de um run com registros', async () => {
    await sydleService.warnOnSuspiciousRun({
      fetched: 0,
      previousFetched: 137,
      contractViolations: 0,
    });

    expect(alertMocks.create).toHaveBeenCalledTimes(1);
    const alerta = alertMocks.create.mock.calls[0][0];
    expect(alerta.severity).toBe('warning');
    expect(alerta.title).toMatch(/vazia/i);
    expect(alerta.message).toContain('137');
  });

  it('NAO alerta quando o run traz registros', async () => {
    await sydleService.warnOnSuspiciousRun({
      fetched: 42,
      previousFetched: 137,
      contractViolations: 0,
    });

    expect(alertMocks.create).not.toHaveBeenCalled();
  });

  it('NAO alerta no primeiro run da historia, que nao tem anterior', async () => {
    await sydleService.warnOnSuspiciousRun({
      fetched: 0,
      previousFetched: null,
      contractViolations: 0,
    });

    expect(alertMocks.create).not.toHaveBeenCalled();
  });

  it('NAO repete o alerta quando o anterior tambem foi zero', async () => {
    // Zeros consecutivos sao o mesmo problema ja anunciado. A transicao e o
    // que importa; a deduplicacao do alertService cuida do resto.
    await sydleService.warnOnSuspiciousRun({
      fetched: 0,
      previousFetched: 0,
      contractViolations: 0,
    });

    expect(alertMocks.create).not.toHaveBeenCalled();
  });

  it('alerta separadamente quando registros chegam SEM identificador', async () => {
    // Registro que chega mas nao produz identidade utilizavel nao aparece como
    // erro nem reduz a contagem: some na conciliacao, em silencio.
    await sydleService.warnOnSuspiciousRun({
      fetched: 200,
      previousFetched: 190,
      contractViolations: 12,
    });

    expect(alertMocks.create).toHaveBeenCalledTimes(1);
    const alerta = alertMocks.create.mock.calls[0][0];
    expect(alerta.title).toMatch(/identificador/i);
    expect(alerta.message).toContain('12');
    expect(alerta.message).toContain('200');
  });

  it('falha ao criar alerta nao derruba o sync', async () => {
    alertMocks.create.mockRejectedValueOnce(new Error('chat fora'));

    await expect(
      sydleService.warnOnSuspiciousRun({
        fetched: 0,
        previousFetched: 5,
        contractViolations: 0,
      }),
    ).resolves.toBeUndefined();
  });
});
