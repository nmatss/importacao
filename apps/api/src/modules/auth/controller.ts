import type { Request, Response } from 'express';
import { authService, type AuditActor } from './service.js';
import { sendSuccess, sendError } from '../../shared/utils/response.js';
import { AppError } from '../../shared/errors/index.js';
import { logger } from '../../shared/utils/logger.js';
import type { AuthenticatedRequest } from '../../shared/types/index.js';

/**
 * Traduz a excecao para a resposta HTTP sem vazar detalhe interno.
 *
 * `AppError` e mensagem de produto — escrita para o usuario ler — e sai como
 * esta, com o proprio status: 401 faz o front jogar para /login?expired=1, e
 * erro de infra (503) ou falta de permissao (403) precisam sair distintos,
 * senao viram "sessao expirou" e a pessoa repete o login sem ver o motivo.
 *
 * Qualquer outra excecao pode carregar o nome do indice do Postgres numa
 * violacao de constraint, ou host e porta internos numa falha de conexao;
 * dessas o cliente recebe mensagem generica e o detalhe fica so no log.
 */
function fail(
  res: Response,
  error: unknown,
  context: string,
  fallbackMessage: string,
  fallbackStatus = 400,
  level: 'warn' | 'error' = 'error',
) {
  if (error instanceof AppError) {
    logger.warn({ err: error }, context);
    return sendError(res, error.message, error.statusCode);
  }
  logger[level]({ err: error }, context);
  return sendError(res, fallbackMessage, fallbackStatus);
}

/**
 * Mensagem do 500 de login. Diz que o problema e nosso, sem nomear banco, host
 * ou driver — quem esta na tela precisa saber que nao adianta redigitar a senha.
 */
const LOGIN_FAILURE_MESSAGE =
  'Não foi possível concluir o login agora. Tente novamente em alguns minutos.';

/** Ator da operacao administrativa, para `audit_logs`. */
function actorOf(req: Request): AuditActor {
  return { id: req.user?.id ?? null, ip: req.ip ?? null };
}

export const authController = {
  async login(req: Request, res: Response) {
    try {
      const { email, password } = req.body;
      const result = await authService.login(email, password);
      sendSuccess(res, result);
    } catch (error: unknown) {
      // Credencial errada vem como `UnauthorizedError` do service e sai 401 com
      // a mensagem de produto. O fallback aqui e so para o que NAO e credencial
      // — Postgres fora do ar, por exemplo. Ate 29/08 esse caso caia no mesmo
      // 401 "Credenciais inválidas": quem estava na tela repetia a senha
      // enquanto o banco estava caido. Agora sai 500 generico (sem host, porta
      // nem driver), e o detalhe fica so no log.
      fail(res, error, 'Falha no login', LOGIN_FAILURE_MESSAGE, 500, 'error');
    }
  },

  async loginWithGoogle(req: Request, res: Response) {
    try {
      const { credential } = req.body;
      if (!credential) {
        return sendError(res, 'Token Google não fornecido', 400);
      }
      const result = await authService.loginWithGoogle(credential);
      sendSuccess(res, result);
    } catch (error: unknown) {
      // Mesmo raciocinio do login por senha: token invalido ja vem como
      // `UnauthorizedError` (401). O resto e infraestrutura e sai 500.
      fail(res, error, 'Falha no login com Google', LOGIN_FAILURE_MESSAGE, 500, 'error');
    }
  },

  async getMe(req: Request, res: Response) {
    try {
      const { id } = (req as AuthenticatedRequest).user;
      const user = await authService.getMe(id);
      sendSuccess(res, user);
    } catch (error: unknown) {
      fail(res, error, 'Falha ao carregar o usuário autenticado', 'Usuário não encontrado', 404);
    }
  },

  async listUsers(_req: Request, res: Response) {
    try {
      const usersList = await authService.listUsers();
      sendSuccess(res, usersList);
    } catch (error: unknown) {
      fail(res, error, 'Falha ao listar usuários', 'Não foi possível listar os usuários');
    }
  },

  async createUser(req: Request, res: Response) {
    try {
      const user = await authService.createUser(req.body, actorOf(req));
      sendSuccess(res, user, 201);
    } catch (error: unknown) {
      fail(res, error, 'Falha ao criar usuário', 'Não foi possível criar o usuário');
    }
  },

  async updateUser(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const user = await authService.updateUser(Number(id), req.body, actorOf(req));
      sendSuccess(res, user);
    } catch (error: unknown) {
      fail(res, error, 'Falha ao atualizar usuário', 'Não foi possível atualizar o usuário');
    }
  },

  async deleteUser(req: Request, res: Response) {
    try {
      const { id } = req.params;
      await authService.deleteUser(Number(id), actorOf(req));
      sendSuccess(res, { message: 'Usuário desativado' });
    } catch (error: unknown) {
      fail(res, error, 'Falha ao desativar usuário', 'Não foi possível desativar o usuário');
    }
  },
};
