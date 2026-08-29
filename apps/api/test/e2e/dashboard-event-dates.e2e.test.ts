import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import postgres from 'postgres';
import {
  handleE2ESetupFailure,
  setupE2EDatabase,
  signTestToken,
  E2E_ADMIN,
  E2E_ANALYST,
  type E2EContext,
} from './setup.js';

/**
 * Executa de verdade contra Postgres o SQL dos KPIs de prazo. Os testes
 * unitarios do dashboard inspecionam a clausula gerada; estes provam que ela
 * (a) e SQL valido e (b) responde o numero certo.
 *
 * O defeito coberto: `import_processes.updated_at` e reescrito em TODA edicao,
 * entao editar uma nota num processo concluido em janeiro o recontabilizava
 * como "concluido neste mes" e zerava o tempo dele no estagio.
 */

let ctx: E2EContext;
let skipReason: string | null = null;
let adminToken: string;
let analystToken: string;
let sql: postgres.Sql;

/**
 * /overview e /sla sao cacheados por 60s e, sem Redis, o fallback em memoria
 * responde de dentro do proprio processo — sem invalidar a chave o teste leria
 * o valor anterior e passaria sem exercitar o SQL. Invalida antes de cada GET.
 */
async function getFresh(app: unknown, path: string, key: string, token: string) {
  const { cache } = await import('../../src/shared/cache/redis.js');
  await cache.del(key);
  return request(app as Parameters<typeof request>[0])
    .get(path)
    .set('Authorization', `Bearer ${token}`);
}

const MES_PASSADO = '2026-01-15T10:00:00Z';

beforeAll(async () => {
  try {
    ctx = await setupE2EDatabase();
    adminToken = signTestToken(E2E_ADMIN);
    analystToken = signTestToken(E2E_ANALYST);
    sql = postgres(ctx.connectionString, { max: 1 });
  } catch (err) {
    skipReason = handleE2ESetupFailure(err);
  }
}, 60_000);

afterAll(async () => {
  await sql?.end();
  await ctx?.cleanup();
});

/** Processo concluido HA MESES, com o evento historico correspondente. */
async function seedConcluidoNoPassado(code: string) {
  const [proc] = await sql<{ id: number }[]>`
    INSERT INTO import_processes (process_code, brand, status, created_by, created_at, updated_at)
    VALUES (${code}, 'puket', 'completed', ${E2E_ADMIN.id}, ${MES_PASSADO}, ${MES_PASSADO})
    RETURNING id
  `;
  await sql`
    INSERT INTO process_events (process_id, event_type, title, metadata, created_at)
    VALUES (${proc.id}, 'status_changed', 'Status alterado para completed',
            ${sql.json({ previousStatus: 'sent_to_fenicia', newStatus: 'completed' })},
            ${MES_PASSADO})
  `;
  return proc.id;
}

describe('KPIs de prazo usam a data do evento, nao updated_at', () => {
  it('editar um processo concluido no passado NAO o recontabiliza no mes corrente', async () => {
    if (skipReason) {
      console.warn(`SKIP: ${skipReason}`);
      return;
    }
    const { app } = await import('../../src/app.js');
    const id = await seedConcluidoNoPassado('E2E-DATE-001');

    const antes = await getFresh(app, '/api/dashboard/overview', 'dashboard:overview', adminToken);
    expect(antes.status).toBe(200);
    const baseline = antes.body.data.completedThisMonth;

    // A edicao que causava o bug: um campo sem nenhuma relacao com o estagio.
    await sql`UPDATE import_processes SET notes = 'anotacao tardia', updated_at = now() WHERE id = ${id}`;
    const depois = await getFresh(app, '/api/dashboard/overview', 'dashboard:overview', adminToken);

    expect(depois.status).toBe(200);
    expect(depois.body.data.completedThisMonth).toBe(baseline);
    // Havia evento historico para este processo: nada de fallback.
    expect(depois.body.data.completedThisMonthFallbackCount).toBe(0);
    expect(depois.body.data.completedThisMonthApproximate).toBe(false);
  });

  it('processo sem evento historico entra pelo fallback e a resposta diz que e aproximado', async () => {
    if (skipReason) {
      console.warn(`SKIP: ${skipReason}`);
      return;
    }
    const { app } = await import('../../src/app.js');
    // Concluido "agora" mas SEM process_events — o caso dos processos antigos.
    await sql`
      INSERT INTO import_processes (process_code, brand, status, created_by, created_at, updated_at)
      VALUES ('E2E-DATE-002', 'puket', 'completed', ${E2E_ADMIN.id}, now(), now())
    `;

    const res = await getFresh(app, '/api/dashboard/overview', 'dashboard:overview', adminToken);

    expect(res.status).toBe(200);
    expect(res.body.data.completedThisMonth).toBeGreaterThanOrEqual(1);
    expect(res.body.data.completedThisMonthFallbackCount).toBeGreaterThanOrEqual(1);
    expect(res.body.data.completedThisMonthApproximate).toBe(true);
  });

  it('KPIs executivos e timeline respondem com o SQL novo (subquery correlacionada valida)', async () => {
    if (skipReason) {
      console.warn(`SKIP: ${skipReason}`);
      return;
    }
    const { app } = await import('../../src/app.js');
    // Um processo parado em 'validating' desde o mes passado, com evento.
    const [proc] = await sql<{ id: number }[]>`
      INSERT INTO import_processes (process_code, brand, status, created_by, created_at, updated_at)
      VALUES ('E2E-DATE-003', 'puket', 'validating', ${E2E_ADMIN.id}, ${MES_PASSADO}, now())
      RETURNING id
    `;
    await sql`
      INSERT INTO process_events (process_id, event_type, title, metadata, created_at)
      VALUES (${proc.id}, 'status_changed', 'Status alterado para validating',
              ${sql.json({ previousStatus: 'draft', newStatus: 'validating' })}, ${MES_PASSADO})
    `;

    const kpis = await request(app)
      .get('/api/dashboard/executive')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(kpis.status).toBe(200);
    expect(kpis.body.data).toHaveProperty('currentChecksPassRate');
    expect(kpis.body.data).toHaveProperty('validationPassRateThisMonth');
    // O nome antigo continua respondendo, para nao quebrar o frontend.
    expect(kpis.body.data).toHaveProperty('validationPassRate');

    const timeline = await request(app)
      .get('/api/dashboard/executive/timeline')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(timeline.status).toBe(200);
    const validating = (timeline.body.data as Array<Record<string, unknown>>).find(
      (r) => r.status === 'validating',
    );
    // Entrou em 'validating' em janeiro e a ultima edicao foi agora: contado
    // pelo evento, sao meses parado — nao zero.
    expect(Number(validating?.avgDaysInStatus)).toBeGreaterThan(30);
    expect(validating).toHaveProperty('fallbackCount');
  });

  it('painel de SLA responde e agrupa aging por id de usuario', async () => {
    if (skipReason) {
      console.warn(`SKIP: ${skipReason}`);
      return;
    }
    const { app } = await import('../../src/app.js');
    // Homonimos: dois usuarios com o MESMO nome, cada um com um processo aberto.
    await sql`UPDATE users SET name = 'Ana Silva' WHERE id IN (${E2E_ADMIN.id}, ${E2E_ANALYST.id})`;
    await sql`
      INSERT INTO import_processes (process_code, brand, status, created_by)
      VALUES ('E2E-DATE-004', 'puket', 'validated', ${E2E_ANALYST.id})
    `;

    const res = await getFresh(app, '/api/dashboard/sla', 'dashboard:sla', adminToken);

    expect(res.status).toBe(200);
    const aging = res.body.data.agingByUser as Array<{ userId: number; userName: string }>;
    const anas = aging.filter((r) => r.userName === 'Ana Silva');
    // Agrupado por nome, as duas Anas colapsavam numa linha so.
    expect(anas).toHaveLength(2);
    expect(new Set(anas.map((r) => r.userId)).size).toBe(2);

    // E o cartao noEspelho traz a marcacao de aproximacao por linha.
    const noEspelho = res.body.data.noEspelho as Array<Record<string, unknown>>;
    expect(noEspelho.length).toBeGreaterThanOrEqual(1);
    expect(noEspelho[0]).toHaveProperty('validatedDateApproximate');
  });
});

describe('Reabertura de processo — ponta a ponta', () => {
  async function criarConcluido(code: string) {
    const [proc] = await sql<{ id: number }[]>`
      INSERT INTO import_processes (process_code, brand, status, created_by)
      VALUES (${code}, 'puket', 'completed', ${E2E_ADMIN.id})
      RETURNING id
    `;
    return proc.id;
  }

  const MOTIVO = 'OHBL corrigido chegou depois do envio a Fenicia';

  it('admin reabre um processo concluido com motivo e a trilha registra tudo', async () => {
    if (skipReason) {
      console.warn(`SKIP: ${skipReason}`);
      return;
    }
    const { app } = await import('../../src/app.js');
    const id = await criarConcluido('E2E-REOPEN-001');

    const res = await request(app)
      .patch(`/api/processes/${id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'validating', reason: MOTIVO });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('validating');

    const eventos = await sql<{ metadata: Record<string, unknown>; created_by: number }[]>`
      SELECT metadata, created_by FROM process_events
       WHERE process_id = ${id} AND event_type = 'status_changed'
    `;
    expect(eventos).toHaveLength(1);
    expect(eventos[0].metadata).toMatchObject({
      previousStatus: 'completed',
      newStatus: 'validating',
      reopen: true,
      reason: MOTIVO,
    });
    expect(eventos[0].created_by).toBe(E2E_ADMIN.id);

    const [audit] = await sql<{ action: string }[]>`
      SELECT action FROM audit_logs
       WHERE entity_type = 'process' AND entity_id = ${id} AND action = 'status_reopen'
    `;
    expect(audit).toBeDefined();
  });

  it('nao-admin recebe 403 ao tentar reabrir', async () => {
    if (skipReason) {
      console.warn(`SKIP: ${skipReason}`);
      return;
    }
    const { app } = await import('../../src/app.js');
    const id = await criarConcluido('E2E-REOPEN-002');

    const res = await request(app)
      .patch(`/api/processes/${id}/status`)
      .set('Authorization', `Bearer ${analystToken}`)
      .send({ status: 'validating', reason: MOTIVO });

    expect(res.status).toBe(403);
    const [row] = await sql<{ status: string }[]>`
      SELECT status FROM import_processes WHERE id = ${id}
    `;
    expect(row.status).toBe('completed');
  });

  it('sem motivo recebe 400 e o processo continua concluido', async () => {
    if (skipReason) {
      console.warn(`SKIP: ${skipReason}`);
      return;
    }
    const { app } = await import('../../src/app.js');
    const id = await criarConcluido('E2E-REOPEN-003');

    const res = await request(app)
      .patch(`/api/processes/${id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'validating' });

    expect(res.status).toBe(400);
    const [row] = await sql<{ status: string }[]>`
      SELECT status FROM import_processes WHERE id = ${id}
    `;
    expect(row.status).toBe('completed');
  });

  it('PUT /:id continua sem aceitar status (o desvio segue fechado)', async () => {
    if (skipReason) {
      console.warn(`SKIP: ${skipReason}`);
      return;
    }
    const { app } = await import('../../src/app.js');
    const id = await criarConcluido('E2E-REOPEN-004');

    await request(app)
      .put(`/api/processes/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'draft', notes: 'tentando burlar' });

    const [row] = await sql<{ status: string }[]>`
      SELECT status FROM import_processes WHERE id = ${id}
    `;
    expect(row.status).toBe('completed');
  });

  it('DELETE de um processo concluido exige motivo e deixa rastro', async () => {
    if (skipReason) {
      console.warn(`SKIP: ${skipReason}`);
      return;
    }
    const { app } = await import('../../src/app.js');
    const id = await criarConcluido('E2E-REOPEN-005');

    const semMotivo = await request(app)
      .delete(`/api/processes/${id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(semMotivo.status).toBe(400);

    const comMotivo = await request(app)
      .delete(`/api/processes/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Processo duplicado, cancelado a pedido do fiscal' });
    expect(comMotivo.status).toBe(200);

    const [row] = await sql<{ status: string }[]>`
      SELECT status FROM import_processes WHERE id = ${id}
    `;
    expect(row.status).toBe('cancelled');
  });

  it('avanco normal de status segue sem motivo e sem admin', async () => {
    if (skipReason) {
      console.warn(`SKIP: ${skipReason}`);
      return;
    }
    const { app } = await import('../../src/app.js');
    const [proc] = await sql<{ id: number }[]>`
      INSERT INTO import_processes (process_code, brand, status, created_by)
      VALUES ('E2E-REOPEN-006', 'puket', 'draft', ${E2E_ADMIN.id})
      RETURNING id
    `;

    const res = await request(app)
      .patch(`/api/processes/${proc.id}/status`)
      .set('Authorization', `Bearer ${analystToken}`)
      .send({ status: 'documents_received' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('documents_received');
  });

  it('GET /:id/events limita o limit a 100', async () => {
    if (skipReason) {
      console.warn(`SKIP: ${skipReason}`);
      return;
    }
    const { app } = await import('../../src/app.js');
    const [proc] = await sql<{ id: number }[]>`
      INSERT INTO import_processes (process_code, brand, status, created_by)
      VALUES ('E2E-REOPEN-007', 'puket', 'draft', ${E2E_ADMIN.id})
      RETURNING id
    `;
    await sql`
      INSERT INTO process_events (process_id, event_type, title)
      SELECT ${proc.id}, 'noop', 'evento ' || g FROM generate_series(1, 120) g
    `;

    const res = await request(app)
      .get(`/api/processes/${proc.id}/events?limit=1000000`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(100);
  });
});
