import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';

const { mockDb, queryQueue } = createMockDb();

const xmlrpcMock = vi.hoisted(() => ({
  createClient: vi.fn(),
  createSecureClient: vi.fn(),
}));

vi.mock('xmlrpc', () => ({
  default: {
    createClient: xmlrpcMock.createClient,
    createSecureClient: xmlrpcMock.createSecureClient,
  },
  createClient: xmlrpcMock.createClient,
  createSecureClient: xmlrpcMock.createSecureClient,
}));

vi.mock('../../../shared/database/connection.js', () => ({
  db: mockDb,
}));

vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const ODOO_ENV_KEYS = ['ODOO_URL', 'ODOO_DB', 'ODOO_USER', 'ODOO_PASSWORD'] as const;
const originalEnv = new Map<string, string | undefined>(
  ODOO_ENV_KEYS.map((key) => [key, process.env[key]]),
);

function restoreEnv() {
  for (const key of ODOO_ENV_KEYS) {
    const original = originalEnv.get(key);
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
}

function clearOdooEnv() {
  for (const key of ODOO_ENV_KEYS) {
    delete process.env[key];
  }
}

function queueSettings(values: Record<string, string | undefined>) {
  for (const key of ['odoo_url', 'odoo_db', 'odoo_user']) {
    const value = values[key];
    queryQueue.push(createResolvedChain(value == null ? [] : [{ key, value }]));
  }
}

async function loadOdooService() {
  vi.resetModules();
  return (await import('../odoo.service.js')).odooService;
}

function createRpcClient(result: unknown) {
  return {
    methodCall: vi.fn(
      (_method: string, _params: unknown[], callback: (err: unknown, result?: unknown) => void) => {
        callback(null, result);
      },
    ),
  };
}

describe('odooService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
    clearOdooEnv();
  });

  afterEach(() => {
    restoreEnv();
  });

  it('should consider Odoo configured from DB settings plus env password', async () => {
    queueSettings({
      odoo_url: 'http://odoo.local:8069',
      odoo_db: 'prod',
      odoo_user: 'integration@example.com',
    });
    process.env.ODOO_PASSWORD = 'secret';

    const odooService = await loadOdooService();

    await expect(odooService.isConfigured()).resolves.toBe(true);
  });

  it('should keep Odoo unconfigured when password is missing from env', async () => {
    queueSettings({
      odoo_url: 'http://odoo.local:8069',
      odoo_db: 'prod',
      odoo_user: 'integration@example.com',
    });

    const odooService = await loadOdooService();

    await expect(odooService.isConfigured()).resolves.toBe(false);
  });

  it('should authenticate with DB settings and HTTP XML-RPC when URL is http', async () => {
    queueSettings({
      odoo_url: 'http://odoo.local:8069/base/',
      odoo_db: 'prod_from_db',
      odoo_user: 'db-user@example.com',
    });
    process.env.ODOO_PASSWORD = 'secret';
    const client = createRpcClient(42);
    xmlrpcMock.createClient.mockReturnValue(client);

    const odooService = await loadOdooService();

    await expect(odooService.authenticate()).resolves.toBe(42);
    expect(xmlrpcMock.createClient).toHaveBeenCalledWith({
      host: 'odoo.local',
      port: 8069,
      path: '/base/xmlrpc/2/common',
    });
    expect(xmlrpcMock.createSecureClient).not.toHaveBeenCalled();
    expect(client.methodCall).toHaveBeenCalledWith(
      'authenticate',
      ['prod_from_db', 'db-user@example.com', 'secret', {}],
      expect.any(Function),
    );
  });

  it('should fall back to env settings and HTTPS XML-RPC when DB settings are absent', async () => {
    queueSettings({});
    process.env.ODOO_URL = 'https://erp.example.com';
    process.env.ODOO_DB = 'prod_from_env';
    process.env.ODOO_USER = 'env-user@example.com';
    process.env.ODOO_PASSWORD = 'secret';
    const client = createRpcClient(77);
    xmlrpcMock.createSecureClient.mockReturnValue(client);

    const odooService = await loadOdooService();

    await expect(odooService.authenticate()).resolves.toBe(77);
    expect(xmlrpcMock.createSecureClient).toHaveBeenCalledWith({
      host: 'erp.example.com',
      port: 443,
      path: '/xmlrpc/2/common',
    });
    expect(xmlrpcMock.createClient).not.toHaveBeenCalled();
    expect(client.methodCall).toHaveBeenCalledWith(
      'authenticate',
      ['prod_from_env', 'env-user@example.com', 'secret', {}],
      expect.any(Function),
    );
  });

  it('should reauthenticate when effective DB settings change', async () => {
    const values = {
      odoo_url: 'https://erp.example.com',
      odoo_db: 'prod',
      odoo_user: 'first@example.com',
    };
    queueSettings(values);
    process.env.ODOO_PASSWORD = 'secret';
    const client = createRpcClient(10);
    client.methodCall
      .mockImplementationOnce(
        (
          _method: string,
          _params: unknown[],
          callback: (err: unknown, result?: unknown) => void,
        ) => {
          callback(null, 10);
        },
      )
      .mockImplementationOnce(
        (
          _method: string,
          _params: unknown[],
          callback: (err: unknown, result?: unknown) => void,
        ) => {
          callback(null, 11);
        },
      );
    xmlrpcMock.createSecureClient.mockReturnValue(client);

    const odooService = await loadOdooService();

    await expect(odooService.authenticate()).resolves.toBe(10);
    values.odoo_user = 'second@example.com';
    queueSettings(values);
    await expect(odooService.authenticate()).resolves.toBe(11);
    expect(client.methodCall).toHaveBeenCalledTimes(2);
  });

  /**
   * Todas as chamadas deste servico sao leituras (`authenticate`, `search`,
   * `read`), entao re-tentar nao duplica registro nenhum no Odoo. Antes disto
   * um `ECONNRESET` no meio da validacao de produtos derrubava a apuracao
   * inteira.
   */
  it('re-tenta uma falha de rede transitoria na autenticacao', async () => {
    queueSettings({
      odoo_url: 'https://erp.example.com',
      odoo_db: 'prod',
      odoo_user: 'user@example.com',
    });
    process.env.ODOO_PASSWORD = 'secret';

    const client = createRpcClient(0);
    client.methodCall
      .mockImplementationOnce(
        (_m: string, _p: unknown[], cb: (err: unknown, result?: unknown) => void) => {
          cb(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
        },
      )
      .mockImplementationOnce(
        (_m: string, _p: unknown[], cb: (err: unknown, result?: unknown) => void) => {
          cb(null, 55);
        },
      );
    xmlrpcMock.createSecureClient.mockReturnValue(client);

    const odooService = await loadOdooService();

    await expect(odooService.authenticate()).resolves.toBe(55);
    expect(client.methodCall).toHaveBeenCalledTimes(2);
  });

  it('NAO re-tenta erro de aplicacao do Odoo (credencial/objeto invalido)', async () => {
    queueSettings({
      odoo_url: 'https://erp.example.com',
      odoo_db: 'prod',
      odoo_user: 'user@example.com',
    });
    process.env.ODOO_PASSWORD = 'secret';

    const client = createRpcClient(0);
    client.methodCall.mockImplementation(
      (_m: string, _p: unknown[], cb: (err: unknown, result?: unknown) => void) => {
        cb(new Error('AccessDenied: invalid credentials'));
      },
    );
    xmlrpcMock.createSecureClient.mockReturnValue(client);

    const odooService = await loadOdooService();

    await expect(odooService.authenticate()).rejects.toThrow('AccessDenied');
    expect(client.methodCall).toHaveBeenCalledTimes(1);
  });
});
