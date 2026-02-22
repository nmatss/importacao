import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { db } from '../database/connection.js';
import { users } from '../database/schema.js';
import { sendError } from '../utils/response.js';

interface UserPayload {
  id: number;
  email: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: UserPayload;
    }
  }
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return sendError(res, 'Token de autenticação não fornecido', 401);
  }

  const token = header.slice(7);
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    return sendError(res, 'Configuração de autenticação ausente', 500);
  }

  try {
    const decoded = jwt.verify(token, secret) as UserPayload;

    const [user] = await db
      .select({ isActive: users.isActive })
      .from(users)
      .where(eq(users.id, decoded.id))
      .limit(1);

    if (!user || !user.isActive) {
      return sendError(res, 'Conta desativada', 401);
    }

    req.user = decoded;
    next();
  } catch {
    return sendError(res, 'Token inválido ou expirado', 401);
  }
}

export function adminMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== 'admin') {
    return sendError(res, 'Acesso restrito a administradores', 403);
  }
  next();
}
