import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/health/integrations` lia `process.env.GOOGLE_CHAT_WEBHOOK_URL` enquanto a
 * entrega resolvia `systemSettings['google_chat_webhook_url']` primeiro.
 * Divergia nas duas direcoes: webhook so no banco fazia o health acusar
 * "ausente" sem motivo, e webhook valido no env com valor quebrado no banco
 * deixava o health verde com o canal morto.
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

vi.mock('../../integrations/google-drive.service.js', () => ({
  ROOT_FOLDER_PLACEHOLDERS: new Set(['your-root-folder-id']),
  googleDriveService: {
    isRootConfigured: vi.fn(async () => false),
    testRootAccess: vi.fn(async () => false),
  },
}));

vi.mock('../../integrations/google-sheets.service.js', () => ({
  googleSheetsService: {
    isConfigured: vi.fn(() => false),
    readProcessReferences: vi.fn(async () => []),
  },
}));

const delivery = vi.hoisted(() => ({
  resolveGoogleChatWebhook: vi.fn(async () => ({
    url: null as string | null,
    source: null as any,
  })),
  getChatDeliverySummary: vi.fn(async () => ({
    lastSentAt: null as Date | null,
    pendentes24h: 0,
  })),
  isUsableWebhookUrl: vi.fn(),
}));
vi.mock('../../alerts/delivery.service.js', async () => {
  const actual = await vi.importActual<typeof import('../../alerts/delivery.service.js')>(
    '../../alerts/delivery.service.js',
  );
  return { ...delivery, isUsableWebhookUrl: actual.isUsableWebhookUrl };
});

const { healthRoutes } = await import('../routes.js');

const WEBHOOK = 'https://chat.googleapis.com/v1/spaces/AAA/messages?key=k&token=t';

function makeApp() {
  const app = express();
  app.use('/health', healthRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  delivery.resolveGoogleChatWebhook.mockResolvedValue({ url: null, source: null });
  delivery.getChatDeliverySummary.mockResolvedValue({ lastSentAt: null, pendentes24h: 0 });
});

describe('GET /health/integrations — alertas', () => {
  it('webhook so no banco NAO e reportado como ausente', async () => {
    delivery.resolveGoogleChatWebhook.mockResolvedValue({ url: WEBHOOK, source: 'database' });

    const res = await request(makeApp()).get('/health/integrations');

    expect(res.body.integracoes.alertas.canalChat).toBe(true);
    expect(res.body.integracoes.alertas.canalChatOrigem).toBe('database');
    expect(res.body.avisos.join(' ')).not.toMatch(/Google Chat/i);
  });

  it('webhook configurado porem invalido NAO fica verde', async () => {
    delivery.resolveGoogleChatWebhook.mockResolvedValue({
      url: 'cole-aqui-o-webhook',
      source: 'database',
    });

    const res = await request(makeApp()).get('/health/integrations');

    expect(res.body.integracoes.alertas.canalChat).toBe(false);
    expect(res.body.avisos.join(' ')).toMatch(/invalido/i);
  });

  it('avisa quando nao ha webhook em lugar nenhum', async () => {
    const res = await request(makeApp()).get('/health/integrations');

    expect(res.body.integracoes.alertas.canalChat).toBe(false);
    expect(res.body.avisos.join(' ')).toMatch(/Google Chat ausente/i);
  });

  it('expoe a ultima entrega bem-sucedida e os pendentes', async () => {
    delivery.resolveGoogleChatWebhook.mockResolvedValue({ url: WEBHOOK, source: 'env' });
    delivery.getChatDeliverySummary.mockResolvedValue({
      lastSentAt: new Date('2026-08-29T10:00:00.000Z'),
      pendentes24h: 3,
    });

    const res = await request(makeApp()).get('/health/integrations');

    expect(res.body.integracoes.alertas.ultimaEntregaEmChat).toBe('2026-08-29T10:00:00.000Z');
    expect(res.body.integracoes.alertas.naoEntreguesUltimas24h).toBe(3);
    expect(res.body.avisos.join(' ')).toMatch(/3 alerta\(s\)/);
  });

  it('nunca ecoa o valor do webhook na resposta', async () => {
    delivery.resolveGoogleChatWebhook.mockResolvedValue({ url: WEBHOOK, source: 'database' });

    const res = await request(makeApp()).get('/health/integrations');

    expect(JSON.stringify(res.body)).not.toContain('token=t');
  });
});
