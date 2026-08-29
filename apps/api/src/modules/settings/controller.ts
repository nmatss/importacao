import type { Request, Response } from 'express';
import { settingsService } from './service.js';
import { sendSuccess, sendError } from '../../shared/utils/response.js';
import { AppError } from '../../shared/errors/index.js';
import { logger } from '../../shared/utils/logger.js';
import { googleDriveService } from '../integrations/google-drive.service.js';
import { odooService } from '../integrations/odoo.service.js';
import { verifySmtpConnection } from '../../shared/mail/mailer.js';
import {
  OPERATIONAL_RECIPIENT_KEYS,
  getOperationalRecipientSettings,
  normalizeEmailList,
} from './operational-recipients.js';

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

/**
 * Chaves que a rota GENERICA `PUT /api/settings/:key` pode escrever.
 *
 * A rota aceitava QUALQUER chave e QUALQUER valor. Duas consequencias:
 *
 * 1. `smtp_from` gravado por aqui escapava do `isValidMailFrom`. O envio falha
 *    fechado depois (`resolveMailFrom` revalida e lanca 503), entao nao havia
 *    injecao de header — mas o efeito era pior de diagnosticar: o e-mail parava
 *    de sair e o erro so aparecia no momento do envio, longe da tela onde o
 *    admin digitou o valor errado.
 * 2. Chave desconhecida virava linha morta na tabela, sem nenhum consumidor.
 *
 * Cada grupo tem rota propria COM validacao. A generica fica so com o que nao
 * tem grupo — hoje, o webhook do Google Chat, que e o unico que o frontend
 * escreve por aqui.
 */
const GENERIC_WRITABLE_KEYS = ['google_chat_webhook_url'] as const;

/** Chave -> rota dedicada que a valida. */
const DEDICATED_ROUTE_BY_KEY: Record<string, string> = {
  ...Object.fromEntries(SMTP_KEYS.map((key) => [key, '/api/settings/smtp'])),
  ...Object.fromEntries(INTEGRATION_KEYS.map((key) => [key, '/api/settings/integrations'])),
  ...Object.fromEntries(OPERATIONAL_RECIPIENT_KEYS.map((key) => [key, '/api/settings/recipients'])),
};

function rejectionForGenericWrite(key: string): string | null {
  const dedicated = DEDICATED_ROUTE_BY_KEY[key];
  if (dedicated) {
    return `Use ${dedicated} para alterar esta configuração — aquela rota valida o valor antes de gravar.`;
  }

  if (!(GENERIC_WRITABLE_KEYS as readonly string[]).includes(key)) {
    return `Configuração desconhecida: "${key}". Nenhum ponto do sistema lê essa chave, então gravá-la não teria efeito.`;
  }

  return null;
}

/**
 * Erro deliberado do proprio modulo, escrito para o usuario ler.
 *
 * `settings/service.ts` nao usa `AppError`: sinaliza com `Object.assign(new
 * Error(mensagem), { statusCode })` — "Assinatura nao encontrada" (404),
 * "Limite de 4 assinaturas por usuario atingido" (400), "Já existe um modelo
 * ativo com esse nome" (409). O contrato duck-typed e reconhecido aqui para
 * que a mensagem de produto continue chegando ao usuario.
 *
 * Restrito a 4xx de proposito: um erro de infraestrutura que por acaso carregue
 * `statusCode` 5xx nao passa a devolver a propria mensagem.
 */
function isProductError(error: unknown): error is Error & { statusCode: number } {
  if (!(error instanceof Error)) return false;
  const status = (error as { statusCode?: unknown }).statusCode;
  return typeof status === 'number' && status >= 400 && status < 500;
}

/**
 * Traduz a excecao para a resposta HTTP sem vazar detalhe interno.
 *
 * Mensagem de produto (`AppError` ou o contrato acima) sai como esta, com o
 * proprio status. Qualquer outra excecao pode carregar o nome do indice do
 * Postgres numa violacao de constraint, ou host e porta internos numa falha de
 * conexao; dessas o cliente recebe mensagem generica e o detalhe fica so no
 * log. Antes o controller usava `error.statusCode || 400` com `error.message`
 * cru, entao todo erro de infra saia como 400 com o texto do driver dentro.
 */
function fail(res: Response, error: unknown, context: string, fallbackMessage: string) {
  if (error instanceof AppError) {
    logger.warn({ err: error }, context);
    return sendError(res, error.message, error.statusCode);
  }
  if (isProductError(error)) {
    logger.warn({ err: error }, context);
    return sendError(res, error.message, error.statusCode);
  }
  logger.error({ err: error }, context);
  return sendError(res, fallbackMessage, 500);
}

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
    } catch (error: unknown) {
      fail(res, error, 'Falha ao ler configurações', 'Não foi possível carregar as configurações');
    }
  },

  async get(req: Request, res: Response) {
    try {
      const setting = await settingsService.get(req.params.key);
      if (!setting) return sendError(res, 'Configuração não encontrada', 404);
      sendSuccess(res, setting);
    } catch (error: unknown) {
      fail(res, error, 'Falha ao ler configuração', 'Não foi possível carregar a configuração');
    }
  },

  async set(req: Request, res: Response) {
    try {
      const rejection = rejectionForGenericWrite(req.params.key);
      if (rejection) return sendError(res, rejection, 400);

      const { value, description } = req.body;
      const setting = await settingsService.set(req.params.key, value, description);
      sendSuccess(res, setting);
    } catch (error: unknown) {
      fail(res, error, 'Falha ao gravar configuração', 'Não foi possível salvar a configuração');
    }
  },

  async getSmtp(_req: Request, res: Response) {
    try {
      const settings = await getGroupSettings(SMTP_KEYS, SMTP_ENV);
      sendSuccess(res, settings);
    } catch (error: unknown) {
      fail(
        res,
        error,
        'Falha ao ler configurações de SMTP',
        'Não foi possível carregar as configurações de SMTP',
      );
    }
  },

  async saveSmtp(req: Request, res: Response) {
    try {
      await saveGroupSettings(req.body, SMTP_KEYS);
      sendSuccess(res, { saved: true });
    } catch (error: unknown) {
      fail(
        res,
        error,
        'Falha ao gravar configurações de SMTP',
        'Não foi possível salvar as configurações de SMTP',
      );
    }
  },

  async testSmtp(_req: Request, res: Response) {
    try {
      await verifySmtpConnection();
      sendSuccess(res, { connected: true });
    } catch (error: any) {
      const code = typeof error?.code === 'string' ? error.code : '';
      const message =
        code === 'EAUTH'
          ? 'Autenticação SMTP recusada. Revise usuário, senha de aplicativo e permissões da conta.'
          : ['ETIMEDOUT', 'ECONNECTION', 'ECONNREFUSED', 'ENOTFOUND'].includes(code)
            ? 'Servidor SMTP indisponível. Revise host, porta, TLS e conectividade de rede.'
            : code === 'SMTP_NOT_CONFIGURED'
              ? 'SMTP não configurado. Defina o host antes de testar.'
              : 'Não foi possível validar a conexão SMTP.';
      sendError(res, message, error?.statusCode || 503);
    }
  },

  async getIntegrations(_req: Request, res: Response) {
    try {
      const settings = await getGroupSettings(INTEGRATION_KEYS, INTEGRATION_ENV);
      sendSuccess(res, settings);
    } catch (error: unknown) {
      fail(
        res,
        error,
        'Falha ao ler configurações de integração',
        'Não foi possível carregar as configurações de integração',
      );
    }
  },

  async saveIntegrations(req: Request, res: Response) {
    try {
      await saveGroupSettings(req.body, INTEGRATION_KEYS);
      sendSuccess(res, { saved: true });
    } catch (error: unknown) {
      fail(
        res,
        error,
        'Falha ao gravar configurações de integração',
        'Não foi possível salvar as configurações de integração',
      );
    }
  },

  async getRecipients(_req: Request, res: Response) {
    try {
      const settings = await getOperationalRecipientSettings();
      sendSuccess(res, settings);
    } catch (error: unknown) {
      fail(
        res,
        error,
        'Falha ao ler destinatários operacionais',
        'Não foi possível carregar os destinatários',
      );
    }
  },

  async saveRecipients(req: Request, res: Response) {
    try {
      for (const key of OPERATIONAL_RECIPIENT_KEYS) {
        if (key in req.body) {
          await settingsService.set(key, normalizeEmailList(req.body[key]));
        }
      }
      const settings = await getOperationalRecipientSettings();
      sendSuccess(res, settings);
    } catch (error: unknown) {
      fail(
        res,
        error,
        'Falha ao gravar destinatários operacionais',
        'Não foi possível salvar os destinatários',
      );
    }
  },

  async testDrive(_req: Request, res: Response) {
    try {
      const configured = await googleDriveService.isRootConfigured();
      if (!configured) return sendError(res, 'Google Drive não está configurado');

      const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
      if (!rootFolderId || rootFolderId === 'your-root-folder-id') {
        return sendError(res, 'GOOGLE_DRIVE_ROOT_FOLDER_ID não configurado');
      }

      await googleDriveService.listProcessFiles(rootFolderId);
      sendSuccess(res, { connected: true });
    } catch (error: unknown) {
      fail(
        res,
        error,
        'Falha no teste de conexão com o Google Drive',
        'Falha na conexão com Google Drive',
      );
    }
  },

  async testOdoo(_req: Request, res: Response) {
    try {
      const configured = await odooService.isConfigured();
      if (!configured) return sendError(res, 'Odoo não está configurado');

      const uid = await odooService.authenticate();
      sendSuccess(res, { connected: true, uid });
    } catch (error: unknown) {
      fail(res, error, 'Falha no teste de conexão com o Odoo', 'Falha na conexão com Odoo');
    }
  },

  // ── Email Signatures ────────────────────────────────────────────────

  async getSignatures(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const signatures = await settingsService.getSignatures(userId);
      sendSuccess(res, signatures);
    } catch (error: unknown) {
      fail(
        res,
        error,
        'Falha ao listar assinaturas de e-mail',
        'Não foi possível carregar as assinaturas',
      );
    }
  },

  async createSignature(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const signature = await settingsService.createSignature(userId, req.body);
      sendSuccess(res, signature, 201);
    } catch (error: unknown) {
      fail(
        res,
        error,
        'Falha ao criar assinatura de e-mail',
        'Não foi possível criar a assinatura',
      );
    }
  },

  async updateSignature(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const id = Number(req.params.id);
      if (isNaN(id) || id <= 0) return sendError(res, 'ID invalido', 400);
      const signature = await settingsService.updateSignature(id, userId, req.body);
      sendSuccess(res, signature);
    } catch (error: unknown) {
      fail(
        res,
        error,
        'Falha ao atualizar assinatura de e-mail',
        'Não foi possível atualizar a assinatura',
      );
    }
  },

  async deleteSignature(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const id = Number(req.params.id);
      if (isNaN(id) || id <= 0) return sendError(res, 'ID invalido', 400);
      const result = await settingsService.deleteSignature(id, userId);
      sendSuccess(res, result);
    } catch (error: unknown) {
      fail(
        res,
        error,
        'Falha ao remover assinatura de e-mail',
        'Não foi possível remover a assinatura',
      );
    }
  },

  async getCommunicationTemplates(req: Request, res: Response) {
    try {
      const activeOnly = req.query.active !== 'false';
      const templates = await settingsService.getCommunicationTemplates({ activeOnly });
      sendSuccess(res, templates);
    } catch (error: unknown) {
      fail(
        res,
        error,
        'Falha ao listar modelos de comunicação',
        'Não foi possível carregar os modelos',
      );
    }
  },

  async createCommunicationTemplate(req: Request, res: Response) {
    try {
      const template = await settingsService.createCommunicationTemplate(
        req.user?.id ?? null,
        req.body,
      );
      sendSuccess(res, template, 201);
    } catch (error: unknown) {
      fail(res, error, 'Falha ao criar modelo de comunicação', 'Não foi possível criar o modelo');
    }
  },

  async updateCommunicationTemplate(req: Request, res: Response) {
    try {
      const id = Number(req.params.id);
      if (isNaN(id) || id <= 0) return sendError(res, 'ID invalido', 400);
      const template = await settingsService.updateCommunicationTemplate(
        id,
        req.user?.id ?? null,
        req.body,
      );
      sendSuccess(res, template);
    } catch (error: unknown) {
      fail(
        res,
        error,
        'Falha ao atualizar modelo de comunicação',
        'Não foi possível atualizar o modelo',
      );
    }
  },

  async deleteCommunicationTemplate(req: Request, res: Response) {
    try {
      const id = Number(req.params.id);
      if (isNaN(id) || id <= 0) return sendError(res, 'ID invalido', 400);
      const template = await settingsService.deleteCommunicationTemplate(id, req.user?.id ?? null);
      sendSuccess(res, template);
    } catch (error: unknown) {
      fail(
        res,
        error,
        'Falha ao remover modelo de comunicação',
        'Não foi possível remover o modelo',
      );
    }
  },
};
