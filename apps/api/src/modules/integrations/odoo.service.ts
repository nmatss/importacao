import xmlrpc from 'xmlrpc';
import { logger } from '../../shared/utils/logger.js';

let uid: number | null = null;

function createClient(path: string) {
  const url = new URL(process.env.ODOO_URL || 'http://localhost:8069');
  return xmlrpc.createSecureClient({
    host: url.hostname,
    port: Number(url.port) || 443,
    path,
  });
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

export const odooService = {
  async authenticate(): Promise<number> {
    if (uid) return uid;

    const commonClient = createClient('/xmlrpc/2/common');
    const db = process.env.ODOO_DB || '';
    const user = process.env.ODOO_USER || '';
    const password = process.env.ODOO_PASSWORD || '';

    uid = await callAsync(commonClient, 'authenticate', [db, user, password, {}]);
    if (!uid) throw new Error('Odoo authentication failed');

    logger.info({ uid }, 'Odoo authenticated');
    return uid;
  },

  async searchProduct(code: string): Promise<any[]> {
    const userId = await this.authenticate();
    const objectClient = createClient('/xmlrpc/2/object');
    const db = process.env.ODOO_DB || '';
    const password = process.env.ODOO_PASSWORD || '';

    const ids = await callAsync(objectClient, 'execute_kw', [
      db, userId, password,
      'product.product', 'search',
      [[['default_code', '=', code]]],
    ]);

    if (!ids || ids.length === 0) return [];

    return callAsync(objectClient, 'execute_kw', [
      db, userId, password,
      'product.product', 'read',
      [ids],
      { fields: ['id', 'name', 'default_code', 'list_price', 'categ_id'] },
    ]);
  },

  async getProduct(id: number): Promise<any> {
    const userId = await this.authenticate();
    const objectClient = createClient('/xmlrpc/2/object');
    const db = process.env.ODOO_DB || '';
    const password = process.env.ODOO_PASSWORD || '';

    const [product] = await callAsync(objectClient, 'execute_kw', [
      db, userId, password,
      'product.product', 'read',
      [[id]],
      { fields: ['id', 'name', 'default_code', 'list_price', 'categ_id'] },
    ]);

    return product;
  },

  async validateDescription(code: string, description: string): Promise<{ isValid: boolean; odooDescription?: string }> {
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
    return !!(process.env.ODOO_URL && process.env.ODOO_DB && process.env.ODOO_USER && process.env.ODOO_PASSWORD);
  },
};
