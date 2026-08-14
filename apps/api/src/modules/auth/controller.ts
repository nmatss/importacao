import type { Request, Response } from 'express';
import { authService } from './service.js';
import { sendSuccess, sendError } from '../../shared/utils/response.js';
import { AppError } from '../../shared/errors/index.js';
import type { AuthenticatedRequest } from '../../shared/types/index.js';

/**
 * 401 aqui significa "sua credencial nao vale" e o front reage a isso jogando o
 * usuario para /login?expired=1. Erro de infra (503) e falta de permissao (403)
 * precisam sair com o proprio status, senao viram "sessao expirou" e a pessoa
 * fica repetindo o login sem nunca ver o motivo real.
 */
function authStatusCode(error: unknown): number {
  return error instanceof AppError ? error.statusCode : 401;
}

export const authController = {
  async login(req: Request, res: Response) {
    try {
      const { email, password } = req.body;
      const result = await authService.login(email, password);
      sendSuccess(res, result);
    } catch (error: any) {
      sendError(res, error.message, authStatusCode(error));
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
    } catch (error: any) {
      sendError(res, error.message, authStatusCode(error));
    }
  },

  async getMe(req: Request, res: Response) {
    try {
      const { id } = (req as AuthenticatedRequest).user;
      const user = await authService.getMe(id);
      sendSuccess(res, user);
    } catch (error: any) {
      sendError(res, error.message, 404);
    }
  },

  async listUsers(_req: Request, res: Response) {
    try {
      const usersList = await authService.listUsers();
      sendSuccess(res, usersList);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async createUser(req: Request, res: Response) {
    try {
      const user = await authService.createUser(req.body);
      sendSuccess(res, user, 201);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async updateUser(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const user = await authService.updateUser(Number(id), req.body);
      sendSuccess(res, user);
    } catch (error: any) {
      sendError(res, error.message);
    }
  },

  async deleteUser(req: Request, res: Response) {
    try {
      const { id } = req.params;
      await authService.deleteUser(Number(id));
      sendSuccess(res, { message: 'Usuário desativado' });
    } catch (error: any) {
      sendError(res, error.message);
    }
  },
};
