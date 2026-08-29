import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const serviceMocks = vi.hoisted(() => ({
  set: vi.fn().mockResolvedValue({ key: 'k', value: 'v' }),
  get: vi.fn(),
  getAll: vi.fn(),
}));

vi.mock('../service.js', () => ({ settingsService: serviceMocks }));
vi.mock('../../../shared/database/connection.js', () => ({
  db: { select: vi.fn(), insert: vi.fn(), update: vi.fn() },
}));
vi.mock('../../integrations/google-drive.service.js', () => ({
  googleDriveService: { isRootConfigured: vi.fn(), testRootAccess: vi.fn() },
}));
vi.mock('../../integrations/odoo.service.js', () => ({
  odooService: { testConnection: vi.fn() },
}));
vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { settingsController } = await import('../controller.js');

function call(key: string, body: Record<string, unknown> = { value: 'x' }) {
  const req = { params: { key }, body } as unknown as Request;
  const payload: { status: number; body: unknown } = { status: 200, body: undefined };
  const res = {
    status(code: number) {
      payload.status = code;
      return res;
    },
    json(value: unknown) {
      payload.body = value;
      return res;
    },
  } as unknown as Response;
  return { req, res, payload };
}

/**
 * `PUT /api/settings/:key` aceitava QUALQUER chave e QUALQUER valor.
 *
 * O caso que doia: `smtp_from` gravado por aqui escapava do `isValidMailFrom`.
 * O envio falha fechado depois (`resolveMailFrom` revalida e lanca 503), entao
 * nao havia injecao de header — mas o e-mail parava de sair e o erro so
 * aparecia no momento do envio, longe da tela onde o admin digitou o valor.
 */
describe('PUT /api/settings/:key — allowlist de chaves', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceMocks.set.mockResolvedValue({ key: 'k', value: 'v' });
  });

  it('aceita a chave que a rota generica de fato serve', async () => {
    const { req, res, payload } = call('google_chat_webhook_url');
    await settingsController.set(req, res);

    expect(serviceMocks.set).toHaveBeenCalledTimes(1);
    expect(payload.status).toBe(200);
  });

  it('recusa smtp_from e aponta a rota que valida', async () => {
    const { req, res, payload } = call('smtp_from', { value: 'Importacao' });
    await settingsController.set(req, res);

    expect(serviceMocks.set).not.toHaveBeenCalled();
    expect(payload.status).toBe(400);
    expect(JSON.stringify(payload.body)).toContain('/api/settings/smtp');
  });

  it('recusa chave de destinatario operacional e aponta a rota certa', async () => {
    const { req, res, payload } = call('kiom_email');
    await settingsController.set(req, res);

    expect(serviceMocks.set).not.toHaveBeenCalled();
    expect(payload.status).toBe(400);
    expect(JSON.stringify(payload.body)).toContain('/api/settings/recipients');
  });

  it('recusa chave de integracao e aponta a rota certa', async () => {
    const { req, res, payload } = call('drive_root_folder_id');
    await settingsController.set(req, res);

    expect(serviceMocks.set).not.toHaveBeenCalled();
    expect(payload.status).toBe(400);
    expect(JSON.stringify(payload.body)).toContain('/api/settings/integrations');
  });

  it('recusa chave desconhecida, explicando que ninguem a leria', async () => {
    const { req, res, payload } = call('qualquer_coisa_inventada');
    await settingsController.set(req, res);

    expect(serviceMocks.set).not.toHaveBeenCalled();
    expect(payload.status).toBe(400);
    expect(JSON.stringify(payload.body)).toMatch(/desconhecida/i);
  });
});
