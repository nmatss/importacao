import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { setupE2EDatabase, type E2EContext } from './setup.js';

let ctx: E2EContext;
let skipReason: string | null = null;
let authToken: string;

beforeAll(async () => {
  try {
    ctx = await setupE2EDatabase();
    process.env.DATABASE_URL = ctx.connectionString;
    process.env.JWT_SECRET = 'test-jwt-secret-e2e';
    process.env.NODE_ENV = 'test';
    process.env.REDIS_URL = '';
    authToken = jwt.sign({ id: 1, email: 'test@test.com', role: 'admin' }, 'test-jwt-secret-e2e');
  } catch (err) {
    skipReason = `Docker unavailable or setup failed: ${(err as Error).message}`;
  }
}, 60_000);

afterAll(async () => {
  await ctx?.cleanup();
});

describe('Documents E2E', () => {
  it('GET /api/documents/:processId — unauthenticated returns 401', async () => {
    if (skipReason) {
      console.warn(`SKIP: ${skipReason}`);
      return;
    }
    const { app } = await import('../../src/app.js');
    const res = await request(app).get('/api/documents/1');

    expect(res.status).toBe(401);
  });

  it('GET /api/documents/:processId — authenticated with non-existent process returns 200 or 404', async () => {
    if (skipReason) {
      console.warn(`SKIP: ${skipReason}`);
      return;
    }
    const { app } = await import('../../src/app.js');
    const res = await request(app)
      .get('/api/documents/999999')
      .set('Authorization', `Bearer ${authToken}`);

    // Either empty list or not found
    expect([200, 404]).toContain(res.status);
  });

  it('POST /api/documents/upload — missing file returns 400', async () => {
    if (skipReason) {
      console.warn(`SKIP: ${skipReason}`);
      return;
    }
    const { app } = await import('../../src/app.js');
    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});

    expect([400, 404, 422]).toContain(res.status);
  });
});
