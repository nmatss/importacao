import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { eq } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import { users } from '../../shared/database/schema.js';
import type { CreateUserInput, UpdateUserInput } from './schema.js';
import { auditService } from '../audit/service.js';
import { googleGroupsService } from '../integrations/google-groups.service.js';
import { ForbiddenError, ServiceUnavailableError } from '../../shared/errors/index.js';
import { isNetworkError } from '../../shared/utils/resilience.js';
import { logger } from '../../shared/utils/logger.js';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is required');
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN || '';

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

export type LoginFailureReason =
  | 'network_error'
  | 'invalid_token'
  | 'wrong_domain'
  | 'not_in_group'
  | 'inactive_user'
  | 'unknown_user';

export function domainOf(email: string): string {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1).toLowerCase() : 'desconhecido';
}

/**
 * Registra por que uma tentativa de login falhou.
 *
 * Ate 17/08 so o caso `not_in_group` deixava rastro; os demais — inclusive a
 * falha de REDE, que derrubou o acesso por 12 dias em 08/2026 — sumiam sem
 * registro. Como `audit_logs` so guardava login bem-sucedido, o unico detector
 * de problema de acesso passou a ser a usuaria reclamando no WhatsApp.
 *
 * LGPD: guarda o e-mail apenas quando ele ja e nosso (usuario existente na
 * base). Para dominio de fora vai so o dominio — suficiente para investigar,
 * sem colecionar endereco de terceiro.
 *
 * Nunca lanca: instrumentacao nao pode derrubar o fluxo que observa.
 */
export async function recordLoginFailure(
  userId: number | null,
  reason: LoginFailureReason,
  emailOrDomain?: string,
): Promise<void> {
  try {
    await auditService.log(
      userId,
      'login_failed',
      'user',
      userId,
      { reason, ...(emailOrDomain ? { origem: emailOrDomain } : {}) },
      null,
    );
  } catch (err) {
    logger.warn({ err, reason }, 'Falha ao registrar tentativa de login malsucedida');
  }
}

export const authService = {
  async login(email: string, password: string) {
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    if (!user || !user.isActive) {
      // Este caminho ja registrava; nao duplicar.
      await auditService.log(
        null,
        'login_failed',
        'user',
        null,
        { email, reason: 'invalid_credentials' },
        null,
      );
      throw new Error('Credenciais inválidas');
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      await auditService.log(
        null,
        'login_failed',
        'user',
        null,
        { email, reason: 'invalid_credentials' },
        null,
      );
      throw new Error('Credenciais inválidas');
    }

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    });

    auditService.log(user.id, 'login', 'user', user.id, { email: user.email }, null);

    return {
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    };
  },

  async loginWithGoogle(credential: string) {
    // verifyIdToken tambem busca as chaves publicas do Google pela rede. Sem
    // separar os dois casos, uma queda de rede era reportada como credencial
    // invalida (401) e o front mostrava "sessao expirou".
    let ticket;
    try {
      ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: GOOGLE_CLIENT_ID,
      });
    } catch (err) {
      if (isNetworkError(err)) {
        logger.error({ err }, 'Google: falha de rede ao verificar o id_token');
        // Ate 17/08 apenas o caso `not_in_group` deixava rastro. Justamente o
        // caminho de rede — o que derrubou o login por 12 dias em 08/2026 —
        // sumia sem registro, e o unico detector virou a usuaria no WhatsApp.
        await recordLoginFailure(null, 'network_error');
        throw new ServiceUnavailableError(
          'Nao foi possivel falar com o Google agora. Tente novamente em alguns minutos.',
        );
      }
      await recordLoginFailure(null, 'invalid_token');
      throw new Error('Token Google inválido');
    }

    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      await recordLoginFailure(null, 'invalid_token');
      throw new Error('Token Google inválido');
    }

    if (ALLOWED_DOMAIN && !payload.email.endsWith(`@${ALLOWED_DOMAIN}`)) {
      // Dominio de fora: guarda so o dominio, nunca o endereco completo. E
      // pessoa que nao e nossa, e o dominio ja basta para investigar.
      await recordLoginFailure(null, 'wrong_domain', domainOf(payload.email));
      throw new ForbiddenError(`Acesso restrito a contas @${ALLOWED_DOMAIN}`);
    }

    const allowed = await googleGroupsService.isAllowed(payload.email);
    if (!allowed) {
      await auditService.log(
        null,
        'login_failed',
        'user',
        null,
        { email: payload.email, reason: 'not_in_group' },
        null,
      );
      throw new ForbiddenError('Acesso negado: usuário não pertence ao grupo autorizado');
    }

    let [user] = await db.select().from(users).where(eq(users.email, payload.email)).limit(1);

    if (!user) {
      const randomPassword = crypto.randomBytes(32).toString('hex');
      const passwordHash = await bcrypt.hash(randomPassword, 10);
      [user] = await db
        .insert(users)
        .values({
          name: payload.name || payload.email.split('@')[0],
          email: payload.email,
          passwordHash,
          role: 'analyst',
        })
        .returning();
    }

    if (!user.isActive) {
      await recordLoginFailure(user.id, 'inactive_user', payload.email);
      throw new ForbiddenError('Conta desativada');
    }

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    });

    auditService.log(user.id, 'login_google', 'user', user.id, { email: user.email }, null);

    return {
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    };
  },

  async getMe(userId: number) {
    const [user] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        isActive: users.isActive,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) throw new Error('Usuário não encontrado');
    return user;
  },

  async listUsers() {
    return db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        isActive: users.isActive,
        createdAt: users.createdAt,
      })
      .from(users)
      .limit(100);
  },

  async createUser(input: CreateUserInput) {
    const passwordHash = await bcrypt.hash(input.password, 10);
    const [user] = await db
      .insert(users)
      .values({
        name: input.name,
        email: input.email,
        passwordHash,
        role: input.role,
      })
      .returning({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        isActive: users.isActive,
      });
    await auditService.log(null, 'user.created', 'user', user.id, { email: user.email }, null);
    return user;
  },

  async updateUser(id: number, input: UpdateUserInput) {
    const updates: Record<string, any> = { ...input, updatedAt: new Date() };
    if (input.password) {
      updates.passwordHash = await bcrypt.hash(input.password, 10);
      delete updates.password;
    }

    const [user] = await db.update(users).set(updates).where(eq(users.id, id)).returning({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
    });

    if (!user) throw new Error('Usuário não encontrado');
    await auditService.log(null, 'user.updated', 'user', user.id, { email: user.email }, null);
    return user;
  },

  async deleteUser(id: number) {
    const [user] = await db
      .update(users)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning({ id: users.id });

    if (!user) throw new Error('Usuário não encontrado');
    await auditService.log(null, 'user.deleted', 'user', user.id, null, null);
    return user;
  },
};
