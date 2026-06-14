import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { setupE2EDatabase, signTestToken, E2E_ADMIN, type E2EContext } from './setup.js';

let ctx: E2EContext;
let skipReason: string | null = null;
let authToken: string;

beforeAll(async () => {
  try {
    ctx = await setupE2EDatabase();
    // setupE2EDatabase() sets DATABASE_URL/JWT_SECRET/NODE_ENV/REDIS_URL and
    // seeds the admin user; the token below is verified against that secret and
    // resolves to the seeded admin (id 1).
    authToken = signTestToken(E2E_ADMIN);
  } catch (err) {
    skipReason = `Docker unavailable or setup failed: ${(err as Error).message}`;
  }
}, 60_000);

afterAll(async () => {
  await ctx?.cleanup();
});

describe('Processes E2E', () => {
  it('GET /api/processes — unauthenticated returns 401', async () => {
    if (skipReason) {
      console.warn(`SKIP: ${skipReason}`);
      return;
    }
    const { app } = await import('../../src/app.js');
    const res = await request(app).get('/api/processes');

    expect(res.status).toBe(401);
  });

  it('GET /api/processes — authenticated returns list', async () => {
    if (skipReason) {
      console.warn(`SKIP: ${skipReason}`);
      return;
    }
    const { app } = await import('../../src/app.js');
    const res = await request(app)
      .get('/api/processes')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('POST /api/processes — creates process with valid data', async () => {
    if (skipReason) {
      console.warn(`SKIP: ${skipReason}`);
      return;
    }
    const { app } = await import('../../src/app.js');
    const res = await request(app)
      .post('/api/processes')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        processCode: 'E2E-TEST-001',
        brand: 'puket',
      });

    expect([200, 201]).toContain(res.status);
    expect(res.body.success).toBe(true);
    expect(res.body.data.processCode).toBe('E2E-TEST-001');
  });

  it('POST /api/processes — missing required fields returns 400', async () => {
    if (skipReason) {
      console.warn(`SKIP: ${skipReason}`);
      return;
    }
    const { app } = await import('../../src/app.js');
    const res = await request(app)
      .post('/api/processes')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('GET /api/processes/:id — not found returns 404', async () => {
    if (skipReason) {
      console.warn(`SKIP: ${skipReason}`);
      return;
    }
    const { app } = await import('../../src/app.js');
    const res = await request(app)
      .get('/api/processes/999999')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(404);
  });
});
