import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';

const { mockDb, queryQueue } = createMockDb();

vi.mock('../../../shared/database/connection.js', () => ({
  db: mockDb,
}));

vi.mock('../../audit/service.js', () => ({
  auditService: { log: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../integrations/google-groups.service.js', () => ({
  googleGroupsService: { isAllowed: vi.fn().mockResolvedValue(true) },
}));

const { mockVerifyIdToken } = vi.hoisted(() => ({ mockVerifyIdToken: vi.fn() }));

vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    verifyIdToken = (...args: any[]) => mockVerifyIdToken(...args);
  },
}));

const mockHash = vi.fn().mockResolvedValue('$2a$10$hashedpassword');
const mockCompare = vi.fn();

vi.mock('bcryptjs', () => ({
  default: {
    hash: (...args: any[]) => mockHash(...args),
    compare: (...args: any[]) => mockCompare(...args),
  },
}));

const mockSign = vi.fn().mockReturnValue('mock-jwt-token');

vi.mock('jsonwebtoken', () => ({
  default: {
    sign: (...args: any[]) => mockSign(...args),
    verify: vi.fn(),
  },
}));

// Set env before importing service
process.env.JWT_SECRET = 'test-secret';

const { authService } = await import('../service.js');
const { auditService } = await import('../../audit/service.js');
const { googleGroupsService } = await import('../../integrations/google-groups.service.js');
const { ForbiddenError, ServiceUnavailableError } = await import('../../../shared/errors/index.js');

describe('authService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
  });

  describe('login()', () => {
    it('should return token for valid credentials', async () => {
      const mockUser = {
        id: 1,
        name: 'Test User',
        email: 'test@example.com',
        role: 'admin',
        passwordHash: '$2a$10$hashedpassword',
        isActive: true,
      };

      // select user by email
      queryQueue.push(createResolvedChain([mockUser]));
      mockCompare.mockResolvedValue(true);

      const result = await authService.login('test@example.com', 'password123');

      expect(result.token).toBe('mock-jwt-token');
      expect(result.user).toEqual({
        id: 1,
        name: 'Test User',
        email: 'test@example.com',
        role: 'admin',
      });
      expect(mockSign).toHaveBeenCalledWith(
        { id: 1, email: 'test@example.com', role: 'admin' },
        'test-secret',
        expect.objectContaining({ expiresIn: expect.any(String) }),
      );
      expect(auditService.log).toHaveBeenCalled();
    });

    it('should throw for invalid email (user not found)', async () => {
      queryQueue.push(createResolvedChain([]));

      await expect(authService.login('bad@example.com', 'password')).rejects.toThrow('Credenciais');
    });

    it('should throw for inactive user', async () => {
      const mockUser = {
        id: 1,
        email: 'test@example.com',
        passwordHash: 'hash',
        isActive: false,
      };

      queryQueue.push(createResolvedChain([mockUser]));

      await expect(authService.login('test@example.com', 'password')).rejects.toThrow(
        'Credenciais',
      );
    });

    it('should throw for wrong password', async () => {
      const mockUser = {
        id: 1,
        email: 'test@example.com',
        passwordHash: '$2a$10$hashedpassword',
        isActive: true,
      };

      queryQueue.push(createResolvedChain([mockUser]));
      mockCompare.mockResolvedValue(false);

      await expect(authService.login('test@example.com', 'wrongpass')).rejects.toThrow(
        'Credenciais',
      );
    });
  });

  describe('loginWithGoogle()', () => {
    const ticketFor = (email: string) => ({
      getPayload: () => ({ email, name: 'Fulano' }),
    });

    beforeEach(() => {
      vi.mocked(googleGroupsService.isAllowed).mockResolvedValue(true);
    });

    it('sinaliza indisponibilidade (503) quando o Google esta inalcancavel', async () => {
      // Formato real do erro do incidente de 08/2026: Gaxios embrulhando um
      // ETIMEDOUT de socket, sem `response`.
      const gaxiosTimeout = Object.assign(new Error('request to google failed'), {
        code: 'ETIMEDOUT',
        error: { code: 'ETIMEDOUT' },
      });
      mockVerifyIdToken.mockRejectedValueOnce(gaxiosTimeout);

      await expect(authService.loginWithGoogle('cred')).rejects.toBeInstanceOf(
        ServiceUnavailableError,
      );
    });

    it('trata token adulterado como credencial invalida, nao como queda', async () => {
      mockVerifyIdToken.mockRejectedValueOnce(new Error('Wrong recipient'));

      const err = await authService.loginWithGoogle('cred').catch((e) => e);
      expect(err.message).toBe('Token Google inválido');
      expect(err).not.toBeInstanceOf(ServiceUnavailableError);
    });

    it('devolve 403 (nao 401) para quem nao esta no grupo', async () => {
      mockVerifyIdToken.mockResolvedValueOnce(ticketFor('fora@grupounico.com'));
      vi.mocked(googleGroupsService.isAllowed).mockResolvedValue(false);

      const err = await authService.loginWithGoogle('cred').catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenError);
      expect(err.statusCode).toBe(403);
    });

    it('devolve 403 para conta desativada', async () => {
      mockVerifyIdToken.mockResolvedValueOnce(ticketFor('inativo@grupounico.com'));
      queryQueue.push(
        createResolvedChain([
          {
            id: 9,
            name: 'Inativo',
            email: 'inativo@grupounico.com',
            role: 'analyst',
            isActive: false,
          },
        ]),
      );

      const err = await authService.loginWithGoogle('cred').catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenError);
      expect(err.statusCode).toBe(403);
    });

    it('emite token para usuario ativo e no grupo', async () => {
      mockVerifyIdToken.mockResolvedValueOnce(ticketFor('ok@grupounico.com'));
      queryQueue.push(
        createResolvedChain([
          { id: 6, name: 'Fulano', email: 'ok@grupounico.com', role: 'analyst', isActive: true },
        ]),
      );

      const result = await authService.loginWithGoogle('cred');

      expect(result.token).toBe('mock-jwt-token');
      expect(result.user.email).toBe('ok@grupounico.com');
    });
  });

  describe('createUser()', () => {
    it('should create user with hashed password', async () => {
      const input = {
        name: 'New User',
        email: 'new@example.com',
        password: 'securepass',
        role: 'analyst' as const,
      };

      const mockUser = {
        id: 2,
        name: 'New User',
        email: 'new@example.com',
        role: 'analyst',
        isActive: true,
      };

      // insert returning
      queryQueue.push(createResolvedChain([mockUser]));

      const result = await authService.createUser(input);

      expect(result).toEqual(mockUser);
      expect(mockHash).toHaveBeenCalledWith('securepass', 10);
      expect(mockDb.insert).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        null,
        'user.created',
        'user',
        2,
        { email: 'new@example.com' },
        null,
      );
    });
  });

  describe('listUsers()', () => {
    it('should return users without password field', async () => {
      const mockUsers = [
        {
          id: 1,
          name: 'User 1',
          email: 'u1@test.com',
          role: 'admin',
          isActive: true,
          createdAt: new Date(),
        },
        {
          id: 2,
          name: 'User 2',
          email: 'u2@test.com',
          role: 'analyst',
          isActive: true,
          createdAt: new Date(),
        },
      ];

      queryQueue.push(createResolvedChain(mockUsers));

      const result = await authService.listUsers();

      expect(result).toEqual(mockUsers);
      expect(result).toHaveLength(2);
      // Verify no passwordHash in results
      for (const user of result) {
        expect(user).not.toHaveProperty('passwordHash');
      }
    });
  });

  describe('updateUser()', () => {
    it('should update fields correctly', async () => {
      const mockUser = {
        id: 1,
        name: 'Updated',
        email: 'u@test.com',
        role: 'admin',
        isActive: true,
      };

      // update returning
      queryQueue.push(createResolvedChain([mockUser]));

      const result = await authService.updateUser(1, { name: 'Updated' });

      expect(result).toEqual(mockUser);
      expect(mockDb.update).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        null,
        'user.updated',
        'user',
        1,
        { email: 'u@test.com' },
        null,
      );
    });

    it('should hash password when updating password', async () => {
      const mockUser = { id: 1, name: 'User', email: 'u@test.com', role: 'admin', isActive: true };

      queryQueue.push(createResolvedChain([mockUser]));

      await authService.updateUser(1, { password: 'newpass' });

      expect(mockHash).toHaveBeenCalledWith('newpass', 10);
    });

    it('should throw when user not found', async () => {
      queryQueue.push(createResolvedChain([]));

      await expect(authService.updateUser(999, { name: 'X' })).rejects.toThrow('não encontrado');
    });
  });

  describe('deleteUser()', () => {
    it('should soft delete by setting isActive=false', async () => {
      const mockUser = { id: 1 };

      // update returning
      queryQueue.push(createResolvedChain([mockUser]));

      const result = await authService.deleteUser(1);

      expect(result).toEqual({ id: 1 });
      expect(mockDb.update).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(null, 'user.deleted', 'user', 1, null, null);
    });

    it('should throw when user not found', async () => {
      queryQueue.push(createResolvedChain([]));

      await expect(authService.deleteUser(999)).rejects.toThrow('não encontrado');
    });
  });
});
