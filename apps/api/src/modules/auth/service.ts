import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import { users } from '../../shared/database/schema.js';
import type { CreateUserInput, UpdateUserInput } from './schema.js';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

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

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN as any }
    );

    return {
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    };
  },

  async getMe(userId: number) {
    const [user] = await db.select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      createdAt: users.createdAt,
    }).from(users).where(eq(users.id, userId)).limit(1);

    if (!user) throw new Error('Usuário não encontrado');
    return user;
  },

  async listUsers() {
    return db.select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      createdAt: users.createdAt,
    }).from(users);
  },

  async createUser(input: CreateUserInput) {
    const passwordHash = await bcrypt.hash(input.password, 10);
    const [user] = await db.insert(users).values({
      name: input.name,
      email: input.email,
      passwordHash,
      role: input.role,
    }).returning({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
    });
    return user;
  },

  async updateUser(id: number, input: UpdateUserInput) {
    const updates: Record<string, any> = { ...input, updatedAt: new Date() };
    if (input.password) {
      updates.passwordHash = await bcrypt.hash(input.password, 10);
      delete updates.password;
    }

    const [user] = await db.update(users)
      .set(updates)
      .where(eq(users.id, id))
      .returning({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        isActive: users.isActive,
      });

    if (!user) throw new Error('Usuário não encontrado');
    return user;
  },

  async deleteUser(id: number) {
    const [user] = await db.update(users)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning({ id: users.id });

    if (!user) throw new Error('Usuário não encontrado');
    return user;
  },
};
