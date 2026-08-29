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
// A restricao de organizacao so existe quando ALLOWED_DOMAIN esta definido, e o
// service le a variavel uma unica vez no import. Sem isto o caminho do claim
// `hd` nunca era exercitado pelos testes.
process.env.ALLOWED_DOMAIN = 'grupounico.com';

const { authService } = await import('../service.js');
const { auditService } = await import('../../audit/service.js');
const { googleGroupsService } = await import('../../integrations/google-groups.service.js');
const { ConflictError, ForbiddenError, ServiceUnavailableError, UnauthorizedError } =
  await import('../../../shared/errors/index.js');

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

    /**
     * A raiz do defeito de 29/08: sem uma classe que dissesse "isto e 401 de
     * credencial", o controller usava o mesmo fallback para credencial errada e
     * para banco fora do ar. A credencial precisa carregar o 401 nela mesma...
     */
    it('credencial errada lanca UnauthorizedError (401 de produto)', async () => {
      queryQueue.push(createResolvedChain([]));

      await expect(authService.login('bad@example.com', 'password')).rejects.toMatchObject({
        constructor: UnauthorizedError,
        statusCode: 401,
        code: 'UNAUTHORIZED',
        message: 'Credenciais inválidas',
      });
    });

    /** ...e a queda do banco precisa NAO carregar. */
    it('falha do banco sobe crua, sem virar 401 de credencial', async () => {
      const dbDown = Object.assign(new Error('connect ECONNREFUSED 10.0.0.9:5432'), {
        code: 'ECONNREFUSED',
      });
      queryQueue.push({
        from: () => ({ where: () => ({ limit: () => Promise.reject(dbDown) }) }),
      });

      const error = await authService.login('test@example.com', 'x').catch((e: unknown) => e);

      expect(error).toBe(dbDown);
      expect(error).not.toBeInstanceOf(UnauthorizedError);
    });
  });

  describe('loginWithGoogle()', () => {
    // Payload minimo de um id_token de conta Workspace legitima. `email_verified`
    // e `hd` fazem parte do contrato do Google e agora sao verificados; o helper
    // anterior os omitia e por isso congelava um payload que nunca deveria ter
    // sido aceito.
    const ticketFor = (email: string, overrides: Record<string, unknown> = {}) => ({
      getPayload: () => ({
        email,
        name: 'Fulano',
        email_verified: true,
        hd: 'grupounico.com',
        ...overrides,
      }),
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

    it('recusa id_token cujo email nao foi verificado pelo Google', async () => {
      mockVerifyIdToken.mockResolvedValueOnce(
        ticketFor('ok@grupounico.com', { email_verified: false }),
      );

      const err = await authService.loginWithGoogle('cred').catch((e) => e);
      expect(err.message).toBe('Token Google inválido');
      expect(auditService.log).toHaveBeenCalledWith(
        null,
        'login_failed',
        'user',
        null,
        expect.objectContaining({ reason: 'email_not_verified' }),
        null,
      );
    });

    it('aceita conta cujo hd confere com o dominio corporativo', async () => {
      mockVerifyIdToken.mockResolvedValueOnce(ticketFor('ok@grupounico.com'));
      queryQueue.push(
        createResolvedChain([
          { id: 6, name: 'Fulano', email: 'ok@grupounico.com', role: 'analyst', isActive: true },
        ]),
      );

      const result = await authService.loginWithGoogle('cred');
      expect(result.user.email).toBe('ok@grupounico.com');
    });

    it('recusa hd de outra organizacao mesmo com sufixo de e-mail correto', async () => {
      mockVerifyIdToken.mockResolvedValueOnce(
        ticketFor('ok@grupounico.com', { hd: 'outraempresa.com' }),
      );

      const err = await authService.loginWithGoogle('cred').catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenError);
    });

    it('NAO recusa por ausencia de hd — segue para as barreiras seguintes', async () => {
      // Decisao deliberada: exigir a PRESENCA do claim tem modo de falha
      // catastrofico e binario (se o Google parar de emitir `hd`, ninguem
      // entra, e a recuperacao exige mexer no SOPS e redeployar durante o
      // incidente). `email_verified` + sufixo + grupos continuam obrigatorios.
      mockVerifyIdToken.mockResolvedValueOnce(ticketFor('ok@grupounico.com', { hd: undefined }));
      queryQueue.push(
        createResolvedChain([
          { id: 6, name: 'Fulano', email: 'ok@grupounico.com', role: 'analyst', isActive: true },
        ]),
      );

      const result = await authService.loginWithGoogle('cred');

      expect(result.token).toBe('mock-jwt-token');
      expect(result.user.email).toBe('ok@grupounico.com');
    });

    it('sem hd, o sufixo do e-mail continua barrando dominio de fora', async () => {
      mockVerifyIdToken.mockResolvedValueOnce(
        ticketFor('alguem@outraempresa.com', { hd: undefined }),
      );

      const err = await authService.loginWithGoogle('cred').catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenError);
    });

    it('sem hd, a barreira de grupos do Google continua valendo', async () => {
      mockVerifyIdToken.mockResolvedValueOnce(ticketFor('ok@grupounico.com', { hd: undefined }));
      vi.mocked(googleGroupsService.isAllowed).mockResolvedValue(false);

      const err = await authService.loginWithGoogle('cred').catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenError);
      expect(err.message).toContain('grupo autorizado');
    });

    it('sem hd, email_verified false continua sendo recusa dura', async () => {
      mockVerifyIdToken.mockResolvedValueOnce(
        ticketFor('ok@grupounico.com', { hd: undefined, email_verified: false }),
      );

      const err = await authService.loginWithGoogle('cred').catch((e) => e);
      expect(err.message).toBe('Token Google inválido');
    });

    it('mantem o sufixo do e-mail como segunda barreira quando o hd confere', async () => {
      mockVerifyIdToken.mockResolvedValueOnce(ticketFor('alguem@outraempresa.com'));

      const err = await authService.loginWithGoogle('cred').catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenError);
      // So o dominio vai para o audit — nunca o endereco de terceiro.
      expect(auditService.log).toHaveBeenCalledWith(
        null,
        'login_failed',
        'user',
        null,
        { reason: 'wrong_domain', origem: 'outraempresa.com' },
        null,
      );
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

    it('registra o admin que criou a conta e o IP de origem', async () => {
      queryQueue.push(
        createResolvedChain([
          { id: 3, name: 'Nova', email: 'nova@grupounico.com', role: 'analyst', isActive: true },
        ]),
      );

      await authService.createUser(
        {
          name: 'Nova',
          email: 'nova@grupounico.com',
          password: 'securepass',
          role: 'analyst' as const,
        },
        { id: 7, ip: '10.0.0.5' },
      );

      expect(auditService.log).toHaveBeenCalledWith(
        7,
        'user.created',
        'user',
        3,
        { email: 'nova@grupounico.com' },
        '10.0.0.5',
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

    it('registra o admin que alterou a conta e o IP de origem', async () => {
      queryQueue.push(
        createResolvedChain([
          { id: 1, name: 'User', email: 'u@test.com', role: 'admin', isActive: true },
        ]),
      );

      await authService.updateUser(1, { name: 'User' }, { id: 7, ip: '10.0.0.5' });

      expect(auditService.log).toHaveBeenCalledWith(
        7,
        'user.updated',
        'user',
        1,
        { email: 'u@test.com' },
        '10.0.0.5',
      );
    });

    it('impede que o admin desative a propria conta (409)', async () => {
      const err = await authService
        .updateUser(7, { isActive: false }, { id: 7, ip: '10.0.0.5' })
        .catch((e) => e);

      expect(err).toBeInstanceOf(ConflictError);
      expect(err.statusCode).toBe(409);
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('impede que o admin rebaixe o proprio papel (409)', async () => {
      const err = await authService
        .updateUser(7, { role: 'analyst' }, { id: 7, ip: '10.0.0.5' })
        .catch((e) => e);

      expect(err).toBeInstanceOf(ConflictError);
      expect(err.statusCode).toBe(409);
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('impede desativar o ULTIMO administrador ativo', async () => {
      // alvo
      queryQueue.push(createResolvedChain([{ id: 5, role: 'admin', isActive: true }]));
      // administradores ativos restantes: so ele
      queryQueue.push(createResolvedChain([{ id: 5 }]));

      const err = await authService
        .updateUser(5, { isActive: false }, { id: 7, ip: '10.0.0.5' })
        .catch((e) => e);

      expect(err).toBeInstanceOf(ConflictError);
      expect(err.message).toContain('último administrador ativo');
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('impede rebaixar o ULTIMO administrador ativo', async () => {
      queryQueue.push(createResolvedChain([{ id: 5, role: 'admin', isActive: true }]));
      queryQueue.push(createResolvedChain([{ id: 5 }]));

      const err = await authService
        .updateUser(5, { role: 'analyst' }, { id: 7, ip: '10.0.0.5' })
        .catch((e) => e);

      expect(err).toBeInstanceOf(ConflictError);
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('permite desativar um admin quando ainda resta outro ativo', async () => {
      queryQueue.push(createResolvedChain([{ id: 5, role: 'admin', isActive: true }]));
      queryQueue.push(createResolvedChain([{ id: 5 }, { id: 9 }]));
      queryQueue.push(
        createResolvedChain([
          { id: 5, name: 'Outro', email: 'o@test.com', role: 'admin', isActive: false },
        ]),
      );

      const result = await authService.updateUser(5, { isActive: false }, { id: 7 });

      expect(result.isActive).toBe(false);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('nao conta administradores quando o alvo ja e analista', async () => {
      queryQueue.push(createResolvedChain([{ id: 5, role: 'analyst', isActive: true }]));
      queryQueue.push(
        createResolvedChain([
          { id: 5, name: 'Ana', email: 'a@test.com', role: 'analyst', isActive: false },
        ]),
      );

      const result = await authService.updateUser(5, { isActive: false }, { id: 7 });

      expect(result.id).toBe(5);
      // alvo + update, sem a consulta de contagem
      expect(mockDb.select).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteUser()', () => {
    it('should soft delete by setting isActive=false', async () => {
      // alvo da guarda de ultimo admin (analista: nao dispara contagem)
      queryQueue.push(createResolvedChain([{ id: 1, role: 'analyst', isActive: true }]));
      // update returning
      queryQueue.push(createResolvedChain([{ id: 1 }]));

      const result = await authService.deleteUser(1);

      expect(result).toEqual({ id: 1 });
      expect(mockDb.update).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(null, 'user.deleted', 'user', 1, null, null);
    });

    it('registra o admin que desativou a conta e o IP de origem', async () => {
      queryQueue.push(createResolvedChain([{ id: 1, role: 'analyst', isActive: true }]));
      queryQueue.push(createResolvedChain([{ id: 1 }]));

      await authService.deleteUser(1, { id: 7, ip: '10.0.0.5' });

      expect(auditService.log).toHaveBeenCalledWith(7, 'user.deleted', 'user', 1, null, '10.0.0.5');
    });

    it('should throw when user not found', async () => {
      queryQueue.push(createResolvedChain([]));
      queryQueue.push(createResolvedChain([]));

      await expect(authService.deleteUser(999)).rejects.toThrow('não encontrado');
    });

    it('impede que o admin desative a si mesmo (409)', async () => {
      const err = await authService.deleteUser(7, { id: 7, ip: '10.0.0.5' }).catch((e) => e);

      expect(err).toBeInstanceOf(ConflictError);
      expect(err.statusCode).toBe(409);
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('impede desativar o ULTIMO administrador ativo', async () => {
      queryQueue.push(createResolvedChain([{ id: 5, role: 'admin', isActive: true }]));
      queryQueue.push(createResolvedChain([{ id: 5 }]));

      const err = await authService.deleteUser(5, { id: 7 }).catch((e) => e);

      expect(err).toBeInstanceOf(ConflictError);
      expect(err.message).toContain('último administrador ativo');
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });
});
