import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';
import { inspectSql } from '../../../__tests__/helpers/sql-inspect.js';

const { mockDb, queryQueue } = createMockDb();

vi.mock('../../../shared/database/connection.js', () => ({
  db: mockDb,
}));

vi.mock('../../../shared/cache/redis.js', () => ({
  cache: { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue(undefined) },
}));

const { dashboardService } = await import('../service.js');
const { executiveService } = await import('../executive.service.js');

/** Texto SQL de qualquer argumento Drizzle (condicao, expressao, orderBy). */
function sqlOf(arg: unknown): string {
  return inspectSql(arg).text;
}

/** Parametros bindados — os literais de status viajam como $n, nao inline. */
function paramsOf(arg: unknown): unknown[] {
  return inspectSql(arg).params;
}

/** Nome da coluna fisica de um argumento que e uma Column crua (groupBy). */
function columnName(arg: unknown): string {
  return (arg as { name: string }).name;
}

/** A n-esima chain devolvida por db.select(), na ordem em que foi pedida. */
function chain(n: number) {
  return mockDb.select.mock.results[n].value;
}

/** As colunas projetadas na n-esima chamada de db.select(). */
function projection(n: number): string[] {
  return Object.keys(mockDb.select.mock.calls[n][0] ?? {});
}

const EVENT_SOURCE = /process_events/;
const NEW_STATUS = /metadata->>'newStatus'/;

describe('dashboardService.getOverview() — SQL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
    for (let i = 0; i < 4; i++)
      queryQueue.push(createResolvedChain([{ count: 0, total: '0', approximateCount: 0 }]));
    queryQueue.push(createResolvedChain([]));
    queryQueue.push(createResolvedChain([]));
  });

  // `updatedAt` e reescrito em TODA edicao: editar uma nota num processo
  // concluido em janeiro o recontabilizava como "concluido neste mes".
  it('completedThisMonth recorta pela data do evento status_changed, nao por updated_at', async () => {
    await dashboardService.getOverview();

    const where = sqlOf(chain(1).where.mock.calls[0][0]);
    expect(where).toMatch(EVENT_SOURCE);
    expect(where).toMatch(NEW_STATUS);
    // O recorte temporal nao pode ser um `updated_at >= $x` solto.
    expect(where).not.toMatch(/"updated_at"\s*>=/);
    // updated_at so aparece dentro do COALESCE de fallback.
    expect(where).toMatch(/coalesce\s*\(\s*\(/i);
  });

  it('expoe quantas linhas cairam no fallback (valor aproximado)', async () => {
    queryQueue.length = 0;
    queryQueue.push(createResolvedChain([{ count: 4 }]));
    queryQueue.push(createResolvedChain([{ count: 3, approximateCount: 2 }]));
    queryQueue.push(createResolvedChain([{ total: '0' }]));
    queryQueue.push(createResolvedChain([{ count: 0 }]));
    queryQueue.push(createResolvedChain([]));
    queryQueue.push(createResolvedChain([]));

    const result = await dashboardService.getOverview();

    expect(result.completedThisMonth).toBe(3);
    expect(result.completedThisMonthFallbackCount).toBe(2);
    expect(result.completedThisMonthApproximate).toBe(true);
  });

  // O dashboard baixava 10 registros COMPLETOS (com ai_extracted_data jsonb)
  // para exibir 5 colunas.
  it('recentProcesses projeta apenas as colunas usadas', async () => {
    await dashboardService.getOverview();

    const cols = projection(5);
    expect(cols).toEqual(['id', 'processCode', 'brand', 'status', 'etd', 'createdAt', 'updatedAt']);
    expect(cols).not.toContain('aiExtractedData');
  });

  // A tabela do front rotula a coluna como "Data Criacao"; ordenar por
  // updated_at fazia a lista parecer fora de ordem.
  it('recentProcesses ordena por created_at, a coluna que a tabela mostra', async () => {
    await dashboardService.getOverview();

    const orderBy = sqlOf(chain(5).orderBy.mock.calls[0][0]);
    expect(orderBy).toMatch(/"created_at" desc/i);
    expect(orderBy).not.toMatch(/updated_at/);
  });
});

describe('dashboardService.getSla() — SQL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
    for (let i = 0; i < 8; i++) queryQueue.push(createResolvedChain([]));
  });

  // Query 4 = pendingFenicia, 5 = noEspelho, 7 = agingByUser.
  it('noEspelho data de validacao vem do evento, com fallback para updated_at', async () => {
    await dashboardService.getSla();

    const cols = mockDb.select.mock.calls[4][0] as Record<string, unknown>;
    const validatedDate = sqlOf(cols.validatedDate);
    expect(validatedDate).toMatch(EVENT_SOURCE);
    expect(paramsOf(cols.validatedDate)).toContain('validated');
    expect(validatedDate).toMatch(/coalesce/i);
    expect(sqlOf(cols.daysPending)).toMatch(EVENT_SOURCE);
    // A ordenacao tem que seguir a mesma data, nao updated_at cru.
    expect(sqlOf(chain(4).orderBy.mock.calls[0][0])).toMatch(EVENT_SOURCE);
    // E a resposta avisa quando o valor e aproximado.
    expect(cols).toHaveProperty('validatedDateApproximate');
  });

  it('pendingFenicia prefere o marco espelho_generated_at e so depois o evento', async () => {
    await dashboardService.getSla();

    const cols = mockDb.select.mock.calls[3][0] as Record<string, unknown>;
    const espelhoDate = sqlOf(cols.espelhoGeneratedDate);
    expect(espelhoDate).toMatch(/espelho_generated_at/);
    expect(espelhoDate).toMatch(EVENT_SOURCE);
    // A ordem do COALESCE importa: o marco primeiro, updated_at por ultimo.
    expect(espelhoDate.indexOf('espelho_generated_at')).toBeLessThan(
      espelhoDate.indexOf('process_events'),
    );
    expect(espelhoDate.indexOf('process_events')).toBeLessThan(
      espelhoDate.lastIndexOf('updated_at'),
    );
  });

  // Homonimos colapsavam numa linha so, somando as pendencias de duas pessoas.
  it('agingByUser agrupa pelo id do usuario e devolve o nome junto', async () => {
    await dashboardService.getSla();

    const groupBy = chain(6).groupBy.mock.calls[0];
    expect(columnName(groupBy[0])).toBe('created_by');
    expect(projection(6)).toContain('userId');
    expect(projection(6)).toContain('userName');
  });
});

describe('executiveService — SQL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
  });

  function queueKpis() {
    for (let i = 0; i < 12; i++) {
      queryQueue.push(
        createResolvedChain([{ count: 0, total: '0', passed: 0, approximateCount: 0 }]),
      );
    }
  }

  it('completedThisMonth/LastMonth usam a data do evento de conclusao', async () => {
    queueKpis();
    await executiveService.getExecutiveKpis();

    for (const idx of [2, 3]) {
      const where = sqlOf(chain(idx).where.mock.calls[0][0]);
      expect(where).toMatch(EVENT_SOURCE);
      expect(paramsOf(chain(idx).where.mock.calls[0][0])).toContain('completed');
      expect(where).not.toMatch(/"updated_at"\s*>=\s*\$/);
    }
  });

  it('avgDaysInStatus conta desde a entrada no estagio atual, nao desde a ultima edicao', async () => {
    queryQueue.push(createResolvedChain([]));
    await executiveService.getProcessingTimeline();

    const cols = mockDb.select.mock.calls[0][0] as Record<string, unknown>;
    const avg = sqlOf(cols.avgDaysInStatus);
    expect(avg).toMatch(EVENT_SOURCE);
    expect(avg).toMatch(NEW_STATUS);
    expect(cols).toHaveProperty('fallbackCount');
  });

  it('validationPassRate segue exposto, mas ao lado dos campos honestos', async () => {
    queryQueue.length = 0;
    // 0 total, 1 active, 2 completedThis, 3 completedLast, 4 fobThis, 5 fobLast,
    // 6 retrato atual, 7 checks vivos do mes, 8 checks arquivados do mes, ...
    for (let i = 0; i < 6; i++) queryQueue.push(createResolvedChain([{ count: 0, total: '0' }]));
    queryQueue.push(createResolvedChain([{ total: 10, passed: 5 }])); // retrato: 50%
    queryQueue.push(createResolvedChain([{ total: 3, passed: 3 }])); // vivos do mes
    queryQueue.push(createResolvedChain([{ total: 1, passed: 0 }])); // arquivados do mes
    for (let i = 0; i < 3; i++) queryQueue.push(createResolvedChain([{ count: 0, total: '0' }]));

    const kpis = await executiveService.getExecutiveKpis();

    expect(kpis.validationPassRate).toBe(50); // nome antigo, mesmo numero
    expect(kpis.currentChecksPassRate).toBe(50);
    // 3 de 4 checagens do mes passaram — recorte temporal de verdade.
    expect(kpis.validationPassRateThisMonth).toBe(75);
    expect(kpis.validationPassRateThisMonthSampleSize).toBe(4);

    // A taxa do mes soma validation_results (rodada viva) e
    // validation_result_history (rodadas arquivadas), ambas com recorte.
    expect(sqlOf(chain(7).where.mock.calls[0][0])).toMatch(/"created_at"\s*>=/);
    expect(sqlOf(chain(8).where.mock.calls[0][0])).toMatch(/"run_at"\s*>=/);
    // O retrato antigo continua sem recorte — e por isso que ele NAO e uma taxa.
    expect(chain(6).where).not.toHaveBeenCalled();
  });
});
