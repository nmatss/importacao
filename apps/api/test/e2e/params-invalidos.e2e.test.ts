import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import postgres from 'postgres';
import {
  handleE2ESetupFailure,
  setupE2EDatabase,
  signTestToken,
  E2E_ADMIN,
  type E2EContext,
} from './setup.js';

/**
 * Prova, contra Postgres de verdade, a mudanca de comportamento: um ID invalido
 * na URL passou a ser recusado no limite da API, com 400, em vez de virar
 * `Number('abc')` = NaN, chegar ao driver e voltar como
 * `invalid input syntax for type integer: "NaN"` — um erro de infraestrutura
 * onde cabia "id invalido".
 *
 * A varredura estatica (`params-de-rota.test.ts`) garante que nenhuma rota nova
 * nasca sem a guarda; este arquivo garante que a guarda faz o que promete e que
 * ela nao quebrou nada em volta.
 */
let ctx: E2EContext;
let skipReason: string | null = null;
let token: string;
let sql: postgres.Sql;

beforeAll(async () => {
  try {
    ctx = await setupE2EDatabase();
    token = signTestToken(E2E_ADMIN);
    sql = postgres(ctx.connectionString, { max: 1 });
  } catch (err) {
    skipReason = handleE2ESetupFailure(err);
  }
}, 60_000);

afterAll(async () => {
  await sql?.end();
  await ctx?.cleanup();
});

async function get(caminho: string) {
  const { app } = await import('../../src/app.js');
  return request(app as never)
    .get(caminho)
    .set('Authorization', `Bearer ${token}`);
}

/** Nenhuma resposta pode carregar vocabulario de driver de banco. */
function naoVazaBanco(corpo: unknown) {
  const texto = JSON.stringify(corpo);
  expect(texto).not.toMatch(/invalid input syntax|NaN|postgres|relation |column /i);
}

describe('ID invalido na URL e recusado no limite da API', () => {
  const invalidos = ['abc', '0', '-1', '1.5', 'null', '%20'];

  it.each(invalidos)('GET /api/processes/%s devolve 400, nao erro de banco', async (valor) => {
    if (skipReason) return console.warn(`SKIP: ${skipReason}`);

    const res = await get(`/api/processes/${valor}`);
    expect(res.status).toBe(400);
    naoVazaBanco(res.body);
  });

  it('vale para os outros modulos, e nao so para processes', async () => {
    if (skipReason) return console.warn(`SKIP: ${skipReason}`);

    for (const caminho of [
      '/api/documents/abc',
      '/api/espelhos/abc/download',
      '/api/currency-exchange/process/abc',
      '/api/follow-up/abc',
      '/api/sydle/payments-report/abc',
    ]) {
      const res = await get(caminho);
      expect(res.status, `${caminho} deveria recusar`).toBe(400);
      naoVazaBanco(res.body);
    }
  });

  /**
   * Rota com DOIS parametros: o segundo tambem e validado, e — o que importa
   * mais — o `passthrough` do schema impede que declarar um apague o outro.
   */
  it('valida o segundo parametro de uma rota aninhada', async () => {
    if (skipReason) return console.warn(`SKIP: ${skipReason}`);

    const { app } = await import('../../src/app.js');
    const res = await request(app as never)
      .delete('/api/processes/1/custom-stages/abc')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    naoVazaBanco(res.body);
  });

  /** Contraprova: parametro que NAO e numerico continua passando intacto. */
  it('parametro textual (processCode) nao e afetado', async () => {
    if (skipReason) return console.warn(`SKIP: ${skipReason}`);

    const res = await get('/api/li-tracking/process/PK2052602TJ');
    expect(res.status).not.toBe(400);
  });

  /** Contraprova: ID valido continua chegando ao controller. */
  it('ID valido continua sendo atendido', async () => {
    if (skipReason) return console.warn(`SKIP: ${skipReason}`);

    const [proc] = await sql<{ id: number }[]>`
      INSERT INTO import_processes (process_code, brand, status, created_by)
      VALUES ('E2E-PARAM-001', 'puket', 'draft', ${E2E_ADMIN.id})
      RETURNING id
    `;
    const res = await get(`/api/processes/${proc.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.processCode).toBe('E2E-PARAM-001');
  });
});
