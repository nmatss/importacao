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

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is required');
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN || '';

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

export const authService = {
  async login(email: string, password: string) {
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    if (!user || !user.isActive) {
      throw new Error('Credenciais inválidas');
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
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
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      throw new Error('Token Google inválido');
    }

    if (ALLOWED_DOMAIN && !payload.email.endsWith(`@${ALLOWED_DOMAIN}`)) {
      throw new Error(`Acesso restrito a contas @${ALLOWED_DOMAIN}`);
    }

    const allowed = await googleGroupsService.isAllowed(payload.email);
    if (!allowed) {
      throw new Error('Acesso negado: usuário não pertence ao grupo autorizado');
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
      throw new Error('Conta desativada');
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
