import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * O gate de 28/08 so conferia se a RAIZ do Drive existia. Com a estrutura
 * decidida em 11/09 (D1), a raiz pode estar acessivel e a leitura entregar zero
 * documento porque uma das quatro areas (01. ESPELHOS ... 04. PENDENTES DE
 * CORREÇÃO) nao resolveu, ou porque a varredura nem rodou. Nos dois casos o
 * health ficava verde — e foi assim que o PK220 chegou a reuniao.
 */

vi.mock('../../../shared/middleware/auth.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 1, email: 'a@b.c', role: 'admin' };
    next();
  },
  adminMiddleware: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../../shared/database/connection.js', () => ({
  db: { execute: vi.fn(async () => []) },
}));

vi.mock('../../../shared/cache/redis.js', () => ({
  cache: { get: vi.fn(async () => '1'), set: vi.fn(async () => undefined) },
}));

vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const drive = vi.hoisted(() => ({
  isRootConfigured: vi.fn(async () => true),
  testRootAccess: vi.fn(async () => true),
  resolveDriveAreas: vi.fn(async () => ({
    pendentes: { id: 'pend', name: '04. PENDENTES DE CORREÇÃO' },
    espelhos: { id: 'esp', name: '01. ESPELHOS' },
    imaginarium: { id: 'img', name: '02. IMAGINARIUM' },
    puket: { id: 'puk', name: '03. PUKET' },
  })),
}));

vi.mock('../../integrations/google-drive.service.js', () => ({
  ROOT_FOLDER_PLACEHOLDERS: new Set(['your-root-folder-id']),
  googleDriveService: drive,
}));

vi.mock('../../integrations/google-sheets.service.js', () => ({
  googleSheetsService: {
    isConfigured: vi.fn(() => true),
    readProcessReferences: vi.fn(async () => ['PK2192607SZ']),
  },
}));

vi.mock('../../alerts/delivery.service.js', async () => {
  const actual = await vi.importActual<typeof import('../../alerts/delivery.service.js')>(
    '../../alerts/delivery.service.js',
  );
  return {
    ...actual,
    resolveGoogleChatWebhook: vi.fn(async () => ({
      url: 'https://chat.googleapis.com/v1/spaces/AAA/messages?key=k&token=t',
      source: 'env' as const,
    })),
    getChatDeliverySummary: vi.fn(async () => ({ lastSentAt: new Date(), pendentes24h: 0 })),
  };
});

const { healthRoutes } = await import('../routes.js');
const { setDriveSweepStatus, __resetDriveSweepStatus } =
  await import('../../documents/drive-sweep-status.js');

function makeApp() {
  const app = express();
  app.use('/health', healthRoutes);
  return app;
}

function sweepOk(finishedAt: string) {
  setDriveSweepStatus({
    startedAt: finishedAt,
    finishedAt,
    areas: { pendentes: true, espelhos: true, imaginarium: true, puket: true },
    totals: { processes: 3, imported: 2, skipped: 5, failed: 0 },
    orphanFolders: [],
    duplicatedFolders: [{ code: 'PK2122607NB', paths: ['04/a', '04/b'] }],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetDriveSweepStatus();
  process.env.DOCUMENT_SOURCE = 'drive';
  process.env.GOOGLE_DRIVE_CLIENT_EMAIL = 'sa@example.test';
  delete process.env.DRIVE_WRITE_MODE;
  delete process.env.MANUAL_UPLOAD_ENABLED;
});

afterEach(() => {
  delete process.env.DOCUMENT_SOURCE;
  delete process.env.GOOGLE_DRIVE_CLIENT_EMAIL;
  __resetDriveSweepStatus();
});

describe('GET /health/integrations — pasta PROCESSOS', () => {
  it('area que nao resolve vira aviso, mesmo com a raiz acessivel', async () => {
    drive.resolveDriveAreas.mockResolvedValueOnce({
      pendentes: null,
      espelhos: { id: 'esp', name: '01. ESPELHOS' },
      imaginarium: { id: 'img', name: '02. IMAGINARIUM' },
      puket: { id: 'puk', name: '03. PUKET' },
    } as any);
    sweepOk(new Date().toISOString());

    const res = await request(makeApp()).get('/health/integrations');

    expect(res.body.integracoes.googleDrive.areas.pendentes).toBe(false);
    expect(res.body.avisos.join(' ')).toMatch(/Areas da pasta PROCESSOS nao resolvidas: pendentes/);
  });

  it('varredura recente e sem area faltando nao gera aviso de Drive', async () => {
    sweepOk(new Date().toISOString());

    const res = await request(makeApp()).get('/health/integrations');

    expect(res.body.integracoes.googleDrive.areas).toEqual({
      pendentes: true,
      espelhos: true,
      imaginarium: true,
      puket: true,
    });
    expect(res.body.integracoes.googleDrive.ultimaVarredura.totais.imported).toBe(2);
    expect(res.body.integracoes.googleDrive.ultimaVarredura.pastasDuplicadas).toBe(1);
    expect(res.body.avisos.join(' ')).not.toMatch(/varredura/i);
  });

  it('varredura parada ha mais de 30 minutos vira aviso', async () => {
    sweepOk(new Date(Date.now() - 45 * 60_000).toISOString());

    const res = await request(makeApp()).get('/health/integrations');

    expect(res.body.avisos.join(' ')).toMatch(/Ultima varredura do Drive terminou ha 45 minutos/);
  });

  it('varredura que nem rodou diz o motivo', async () => {
    setDriveSweepStatus({
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      inactiveReason: 'GOOGLE_DRIVE_ROOT_FOLDER_ID ausente ou placeholder',
      areas: { pendentes: false, espelhos: false, imaginarium: false, puket: false },
      totals: { processes: 0, imported: 0, skipped: 0, failed: 0 },
      orphanFolders: [],
      duplicatedFolders: [],
    });

    const res = await request(makeApp()).get('/health/integrations');

    expect(res.body.avisos.join(' ')).toMatch(/nao rodou: GOOGLE_DRIVE_ROOT_FOLDER_ID/);
  });

  it('mostra o modo de escrita e o upload manual', async () => {
    process.env.MANUAL_UPLOAD_ENABLED = 'false';
    sweepOk(new Date().toISOString());

    const res = await request(makeApp()).get('/health/integrations');

    expect(res.body.integracoes.googleDrive.escrita).toMatch(/padrao/);
    expect(res.body.integracoes.documentos.uploadManual).toBe(false);
  });

  it('com DOCUMENT_SOURCE=email nao cobra as areas nem a varredura', async () => {
    process.env.DOCUMENT_SOURCE = 'email';

    const res = await request(makeApp()).get('/health/integrations');

    expect(res.body.avisos.join(' ')).not.toMatch(/varredura|Areas da pasta/);
  });
});
