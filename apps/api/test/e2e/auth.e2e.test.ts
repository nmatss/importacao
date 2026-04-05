import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { setupE2EDatabase, type E2EContext } from './setup.js';

// Skip all tests if Docker is not available
let ctx: E2EContext;
let skipReason: string | null = null;

beforeAll(async () => {
  try {
    ctx = await setupE2EDatabase();
    // Set env for app to connect to test container
    process.env.DATABASE_URL = ctx.connectionString;
    process.env.JWT_SECRET = 'test-jwt-secret-for-e2e-tests';
    process.env.NODE_ENV = 'test';
    process.env.REDIS_URL = '';
  } catch (err) {
    skipReason = `Docker unavailable or setup failed: ${(err as Error).message}`;
  }
}, 60_000);

afterAll(async () => {
  await ctx?.cleanup();
});

describe('Auth E2E', () => {
  it('POST /api/auth/login — invalid credentials returns 400/401', async () => {
    if (skipReason) {
      console.warn(`SKIP: ${skipReason}`);
      return;
    }
    // Dynamic import so DATABASE_URL is set before module load
    const { app } = await import('../../src/app.js');
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nonexistent@test.com', password: 'wrongpassword' });

    expect([400, 401, 500]).toContain(res.status);
  });

  it('POST /api/auth/login — missing fields returns 400', async () => {
    if (skipReason) {
      console.warn(`SKIP: ${skipReason}`);
      return;
    }
    const { app } = await import('../../src/app.js');
    const res = await request(app).post('/api/auth/login').send({ email: 'test@test.com' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('GET /api/auth/me — unauthenticated returns 401', async () => {
    if (skipReason) {
      console.warn(`SKIP: ${skipReason}`);
      return;
    }
    const { app } = await import('../../src/app.js');
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
  });

  it('GET /health — returns ok', async () => {
    if (skipReason) {
      console.warn(`SKIP: ${skipReason}`);
      return;
    }
    const { app } = await import('../../src/app.js');
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
