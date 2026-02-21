import type { Request, Response } from 'express';
import { authService } from './service.js';
import { sendSuccess, sendError } from '../../shared/utils/response.js';
import type { AuthenticatedRequest } from '../../shared/types/index.js';

export const authController = {
  async login(req: Request, res: Response) {
    try {
      const { email, password } = req.body;
      const result = await authService.login(email, password);
      sendSuccess(res, result);
    } catch (error: any) {
      sendError(res, error.message, 401);
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
