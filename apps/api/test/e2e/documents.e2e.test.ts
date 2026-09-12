import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import {
  handleE2ESetupFailure,
  setupE2EDatabase,
  signTestToken,
  E2E_ADMIN,
  type E2EContext,
} from './setup.js';

let ctx: E2EContext;
let skipReason: string | null = null;
let authToken: string;

beforeAll(async () => {
  try {
    ctx = await setupE2EDatabase();
    authToken = signTestToken(E2E_ADMIN);
  } catch (err) {
    skipReason = handleE2ESetupFailure(err);
  }
}, 120_000);

afterAll(async () => {
  await ctx?.cleanup();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Documents E2E', () => {
  it('GET /api/documents/process/:processId — unauthenticated returns 401', async () => {
    if (skipReason) {
      console.warn(`SKIP: ${skipReason}`);
      return;
    }
    const { app } = await import('../../src/app.js');
    const res = await request(app).get('/api/documents/process/1');

    expect(res.status).toBe(401);
  });

  it('GET /api/documents/process/:processId — authenticated with non-existent process returns 200 or 404', async () => {
    if (skipReason) {
      console.warn(`SKIP: ${skipReason}`);
      return;
    }
    const { app } = await import('../../src/app.js');
    const res = await request(app)
      .get('/api/documents/process/999999')
      .set('Authorization', `Bearer ${authToken}`);

    // Either empty list or not found
    expect([200, 404]).toContain(res.status);
  });

  it('POST /api/documents/upload — disabled manual upload rejects before multipart parsing', async () => {
    if (skipReason) {
      console.warn(`SKIP: ${skipReason}`);
      return;
    }
    vi.stubEnv('DOCUMENT_SOURCE', 'drive');
    vi.stubEnv('MANUAL_UPLOAD_ENABLED', 'false');
    const { app } = await import('../../src/app.js');
    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${authToken}`)
      .set('Content-Type', 'multipart/form-data')
      .send('invalid multipart without boundary');

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('Google Drive');
  });

  it('POST /api/documents/upload — enabled manual upload validates missing file with Drive source', async () => {
    if (skipReason) {
      console.warn(`SKIP: ${skipReason}`);
      return;
    }
    vi.stubEnv('DOCUMENT_SOURCE', 'drive');
    vi.stubEnv('MANUAL_UPLOAD_ENABLED', 'true');
    const { app } = await import('../../src/app.js');
    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Nenhum arquivo');
  });
});
