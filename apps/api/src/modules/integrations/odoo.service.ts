import xmlrpc from 'xmlrpc';
import { logger } from '../../shared/utils/logger.js';

let uid: number | null = null;
let uidConfigKey: string | null = null;

type OdooConfig = {
  url: string;
  db: string;
  user: string;
  password: string;
};

const ODOO_SETTINGS = {
  url: { settingKey: 'odoo_url', envKey: 'ODOO_URL' },
  db: { settingKey: 'odoo_db', envKey: 'ODOO_DB' },
  user: { settingKey: 'odoo_user', envKey: 'ODOO_USER' },
} as const;

function toSettingString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  return String(value).trim();
}

async function getDbOrEnvValue(settingKey: string, envKey: string): Promise<string> {
  const dbValue = await getDbSettingValue(settingKey);
  return dbValue || toSettingString(process.env[envKey]);
}

async function getDbSettingValue(settingKey: string): Promise<string> {
  try {
    const { settingsService } = await import('../settings/service.js');
    const setting = await settingsService.get(settingKey);
    return toSettingString(setting?.value);
  } catch (err) {
    if (
      process.env.NODE_ENV === 'test' &&
      err instanceof Error &&
      err.message.includes('DATABASE_URL environment variable is not set')
    ) {
      return '';
    }
    throw err;
  }
}

async function getConfig(): Promise<OdooConfig> {
  const [url, db, user] = await Promise.all([
    getDbOrEnvValue(ODOO_SETTINGS.url.settingKey, ODOO_SETTINGS.url.envKey),
    getDbOrEnvValue(ODOO_SETTINGS.db.settingKey, ODOO_SETTINGS.db.envKey),
    getDbOrEnvValue(ODOO_SETTINGS.user.settingKey, ODOO_SETTINGS.user.envKey),
  ]);

  return {
    url,
    db,
    user,
    password: toSettingString(process.env.ODOO_PASSWORD),
  };
}

function isCompleteConfig(config: OdooConfig): boolean {
  return !!(config.url && config.db && config.user && config.password);
}

function getConfigKey(config: OdooConfig): string {
  return [config.url, config.db, config.user, config.password].join('\n');
}

function createClient(config: OdooConfig, path: string) {
  const url = new URL(config.url);
  const basePath = url.pathname && url.pathname !== '/' ? url.pathname.replace(/\/$/, '') : '';
  const clientOptions = {
    host: url.hostname,
    port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
    path: `${basePath}${path}`,
  };

  if (url.protocol === 'https:') {
    return xmlrpc.createSecureClient(clientOptions);
  }

  if (url.protocol === 'http:') {
    return xmlrpc.createClient(clientOptions);
  }

  throw new Error(`Unsupported Odoo URL protocol: ${url.protocol}`);
}

function callAsync(client: xmlrpc.Client, method: string, params: any[]): Promise<any> {
  const call = new Promise((resolve, reject) => {
    client.methodCall(method, params, (err: any, result: any) => {
      if (err) reject(err);
      else resolve(result);
    });
  });

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Odoo XML-RPC timeout after 30s')), 30_000),
  );

  return Promise.race([call, timeout]);
}

async function authenticateWithConfig(config: OdooConfig): Promise<number> {
  if (!isCompleteConfig(config)) {
    throw new Error('Odoo is not configured');
  }

  const configKey = getConfigKey(config);
  if (uid && uidConfigKey === configKey) return uid;

  const commonClient = createClient(config, '/xmlrpc/2/common');
  uid = await callAsync(commonClient, 'authenticate', [
    config.db,
    config.user,
    config.password,
    {},
  ]);
  if (!uid) throw new Error('Odoo authentication failed');
  uidConfigKey = configKey;

  logger.info({ uid }, 'Odoo authenticated');
  return uid;
}

export const odooService = {
  async authenticate(): Promise<number> {
    const config = await getConfig();
    return authenticateWithConfig(config);
  },

  async searchProduct(code: string): Promise<any[]> {
    const config = await getConfig();
    const userId = await authenticateWithConfig(config);
    const objectClient = createClient(config, '/xmlrpc/2/object');

    const ids = await callAsync(objectClient, 'execute_kw', [
      config.db,
      userId,
      config.password,
      'product.product',
      'search',
      [[['default_code', '=', code]]],
    ]);

    if (!ids || ids.length === 0) return [];

    return callAsync(objectClient, 'execute_kw', [
      config.db,
      userId,
      config.password,
      'product.product',
      'read',
      [ids],
      { fields: ['id', 'name', 'default_code', 'list_price', 'categ_id'] },
    ]);
  },

  async getProduct(id: number): Promise<any> {
    const config = await getConfig();
    const userId = await authenticateWithConfig(config);
    const objectClient = createClient(config, '/xmlrpc/2/object');

    const [product] = await callAsync(objectClient, 'execute_kw', [
      config.db,
      userId,
      config.password,
      'product.product',
      'read',
      [[id]],
      { fields: ['id', 'name', 'default_code', 'list_price', 'categ_id'] },
    ]);

    return product;
  },

  async validateDescription(
    code: string,
    description: string,
  ): Promise<{ isValid: boolean; odooDescription?: string }> {
    const products = await this.searchProduct(code);
    if (products.length === 0) {
      return { isValid: false };
    }

    const product = products[0];
    const odooDesc = (product.name || '').toLowerCase().trim();
    const inputDesc = description.toLowerCase().trim();

    return {
      isValid: odooDesc.includes(inputDesc) || inputDesc.includes(odooDesc),
      odooDescription: product.name,
    };
  },

  async isConfigured(): Promise<boolean> {
    const config = await getConfig();
    return isCompleteConfig(config);
  },
};
