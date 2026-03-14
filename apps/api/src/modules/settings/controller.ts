import type { Request, Response } from 'express';
import { settingsService } from './service.js';
import { sendSuccess, sendError } from '../../shared/utils/response.js';
import { googleDriveService } from '../integrations/google-drive.service.js';
import { odooService } from '../integrations/odoo.service.js';

const SMTP_KEYS = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_from'] as const;
const SMTP_ENV: Record<string, string> = {
  smtp_host: 'SMTP_HOST',
  smtp_port: 'SMTP_PORT',
  smtp_user: 'SMTP_USER',
  smtp_from: 'SMTP_FROM',
};

const INTEGRATION_KEYS = [
  'drive_client_email',
  'drive_root_folder_id',
  'odoo_url',
  'odoo_db',
  'odoo_user',
] as const;
const INTEGRATION_ENV: Record<string, string> = {
  drive_client_email: 'GOOGLE_DRIVE_CLIENT_EMAIL',
  drive_root_folder_id: 'GOOGLE_DRIVE_ROOT_FOLDER_ID',
  odoo_url: 'ODOO_URL',
  odoo_db: 'ODOO_DB',
  odoo_user: 'ODOO_USER',
};

async function getGroupSettings(keys: readonly string[], envMap: Record<string, string>) {
  const results: { key: string; value: string }[] = [];
  for (const key of keys) {
    const setting = await settingsService.get(key);
    const dbValue = setting?.value != null ? String(setting.value) : '';
    results.push({ key, value: dbValue || process.env[envMap[key]] || '' });
  }
  return results;
}

async function saveGroupSettings(body: Record<string, string>, keys: readonly string[]) {
  for (const key of keys) {
    if (key in body) {
      await settingsService.set(key, body[key]);
    }
  }
}

export const settingsController = {
  async getAll(_req: Request, res: Response) {
    try {
      const settings = await settingsService.getAll();
      sendSuccess(res, settings);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async get(req: Request, res: Response) {
    try {
      const setting = await settingsService.get(req.params.key);
      if (!setting) return sendError(res, 'Configuração não encontrada', 404);
      sendSuccess(res, setting);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async set(req: Request, res: Response) {
    try {
      const { value, description } = req.body;
      const setting = await settingsService.set(req.params.key, value, description);
      sendSuccess(res, setting);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async getSmtp(_req: Request, res: Response) {
    try {
      const settings = await getGroupSettings(SMTP_KEYS, SMTP_ENV);
      sendSuccess(res, settings);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async saveSmtp(req: Request, res: Response) {
    try {
      await saveGroupSettings(req.body, SMTP_KEYS);
      sendSuccess(res, { saved: true });
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async getIntegrations(_req: Request, res: Response) {
    try {
      const settings = await getGroupSettings(INTEGRATION_KEYS, INTEGRATION_ENV);
      sendSuccess(res, settings);
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async saveIntegrations(req: Request, res: Response) {
    try {
      await saveGroupSettings(req.body, INTEGRATION_KEYS);
      sendSuccess(res, { saved: true });
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message, status);
    }
  },

  async testDrive(_req: Request, res: Response) {
    try {
      const configured = await googleDriveService.isConfigured();
      if (!configured) return sendError(res, 'Google Drive não está configurado');

      const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
      if (!rootFolderId) return sendError(res, 'GOOGLE_DRIVE_ROOT_FOLDER_ID não configurado');

      await googleDriveService.listProcessFiles(rootFolderId);
      sendSuccess(res, { connected: true });
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message || 'Falha na conexão com Google Drive', status);
    }
  },

  async testOdoo(_req: Request, res: Response) {
    try {
      const configured = await odooService.isConfigured();
      if (!configured) return sendError(res, 'Odoo não está configurado');

      const uid = await odooService.authenticate();
      sendSuccess(res, { connected: true, uid });
    } catch (error: any) {
      const status = error.statusCode || 400;
      sendError(res, error.message || 'Falha na conexão com Odoo', status);
    }
  },
};
