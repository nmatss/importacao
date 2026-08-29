import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  httpRequestsTotal,
  httpRequestDuration,
  metricsMiddleware,
  safeTokenEquals,
} from '../index.js';

/**
 * App que reproduz a montagem real: `metricsMiddleware` antes de qualquer
 * roteamento e o router da API montado em `/api`.
 */
function makeApp() {
  const app = express();
  app.use(metricsMiddleware);

  const api = express.Router();
  api.get('/users/:id', (_req, res) => {
    res.json({ ok: true });
  });
  api.post('/processes', (_req, res) => {
    res.status(201).json({ ok: true });
  });

  // Dois niveis de router, como no app real: app -> apiRouter -> router do modulo.
  const auth = express.Router();
  auth.put('/users/:id', (_req, res) => {
    res.json({ ok: true });
  });
  api.use('/auth', auth);

  app.use('/api', api);

  return app;
}

async function pathLabels(): Promise<string[]> {
  const { values } = await httpRequestsTotal.get();
  return values.map((v) => String(v.labels.path));
}

describe('metricsMiddleware — cardinalidade do rotulo `path`', () => {
  beforeEach(() => {
    httpRequestsTotal.reset();
    httpRequestDuration.reset();
  });

  it('colapsa N caminhos desconhecidos em UMA serie', async () => {
    // O middleware roda antes da autenticacao e `/api` e proxiado pelo edge:
    // qualquer pessoa podia criar uma serie nova por requisicao, para sempre,
    // num container de 512M. 404 nem chega a passar por autenticacao.
    const app = makeApp();
    for (let i = 0; i < 25; i += 1) {
      await request(app).get(`/api/aaa${i}`);
    }

    const labels = new Set(await pathLabels());
    expect(labels).toEqual(new Set(['unknown']));
  });

  it('usa a rota registrada, nao o caminho cru, para requisicoes que casam', async () => {
    const app = makeApp();
    await request(app).get('/api/users/1');
    await request(app).get('/api/users/9999');
    await request(app).get('/api/users/abacate');
    await request(app).post('/api/processes');

    const labels = new Set(await pathLabels());
    expect(labels).toEqual(new Set(['/api/users/:id', '/api/processes']));
  });

  it('resolve o prefixo completo com dois niveis de router aninhado', async () => {
    const app = makeApp();
    await request(app).put('/api/auth/users/7');
    await request(app).put('/api/auth/users/42');

    const labels = new Set(await pathLabels());
    expect(labels).toEqual(new Set(['/api/auth/users/:id']));
  });

  it('conta o desconhecido junto com o conhecido sem inflar a cardinalidade', async () => {
    const app = makeApp();
    await request(app).get('/api/users/1');
    for (let i = 0; i < 10; i += 1) {
      await request(app).get(`/api/${'x'.repeat(i + 1)}`);
    }

    const labels = await pathLabels();
    expect(new Set(labels)).toEqual(new Set(['/api/users/:id', 'unknown']));
    // Uma unica serie `unknown`, com a contagem acumulada nela.
    const { values } = await httpRequestsTotal.get();
    const unknown = values.filter((v) => v.labels.path === 'unknown');
    expect(unknown).toHaveLength(1);
    expect(unknown[0].value).toBe(10);
  });

  it('rotula o histograma de duracao com a mesma rota registrada', async () => {
    const app = makeApp();
    await request(app).get('/api/users/1');
    await request(app).get('/api/desconhecido');

    const { values } = await httpRequestDuration.get();
    const labels = new Set(values.map((v) => String(v.labels.path)));
    expect(labels).toEqual(new Set(['/api/users/:id', 'unknown']));
  });
});

describe('safeTokenEquals', () => {
  it('aceita apenas o token exato', () => {
    expect(safeTokenEquals('s3cr3t-token', 's3cr3t-token')).toBe(true);
    expect(safeTokenEquals('s3cr3t-tokeN', 's3cr3t-token')).toBe(false);
  });

  it('recusa tamanhos diferentes sem lancar (timingSafeEqual exige buffers iguais)', () => {
    expect(() => safeTokenEquals('curto', 'token-bem-mais-longo')).not.toThrow();
    expect(safeTokenEquals('curto', 'token-bem-mais-longo')).toBe(false);
    expect(safeTokenEquals('token-bem-mais-longo', 'curto')).toBe(false);
  });

  it('recusa token ausente ou vazio dos dois lados', () => {
    expect(safeTokenEquals(undefined, 'token')).toBe(false);
    expect(safeTokenEquals('', 'token')).toBe(false);
    expect(safeTokenEquals('token', '')).toBe(false);
  });
});
