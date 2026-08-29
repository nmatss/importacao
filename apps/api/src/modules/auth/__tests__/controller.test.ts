import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authGate = vi.hoisted(() => ({ id: 7, role: 'admin', email: 'admin@grupounico.com' }));

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  loginWithGoogle: vi.fn(),
  getMe: vi.fn(),
  listUsers: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
}));

vi.mock('../service.js', () => ({ authService: mocks }));

vi.mock('../../../shared/middleware/auth.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: authGate.id, email: authGate.email, role: authGate.role };
    next();
  },
  adminMiddleware: (req: any, res: any, next: any) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ success: false });
    next();
  },
}));

vi.mock('../../../shared/middleware/validate.js', () => ({
  validate: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../../shared/middleware/rate-limit.js', () => ({
  createRateLimiter: () => (_req: any, _res: any, next: any) => next(),
}));

const { authRoutes } = await import('../routes.js');
const { ConflictError, ForbiddenError, UnauthorizedError } =
  await import('../../../shared/errors/index.js');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  return app;
}

/** Formato tipico de uma violacao de constraint vinda do driver do Postgres. */
const pgError = Object.assign(
  new Error(
    'duplicate key value violates unique constraint "users_email_unique" — host=db.internal port=5432',
  ),
  { code: '23505' },
);

describe('authController — mensagens de erro', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authGate.id = 7;
    authGate.role = 'admin';
  });

  it('nao devolve a mensagem crua do Postgres ao criar usuário', async () => {
    mocks.createUser.mockRejectedValueOnce(pgError);

    const res = await request(makeApp()).post('/api/auth/users').send({ name: 'X' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Não foi possível criar o usuário');
    expect(res.body.error).not.toContain('users_email_unique');
    expect(res.body.error).not.toContain('db.internal');
  });

  it('nao devolve a mensagem crua do Postgres ao atualizar usuário', async () => {
    mocks.updateUser.mockRejectedValueOnce(pgError);

    const res = await request(makeApp()).put('/api/auth/users/9').send({ name: 'X' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Não foi possível atualizar o usuário');
  });

  it('nao devolve a mensagem crua do Postgres ao desativar usuário', async () => {
    mocks.deleteUser.mockRejectedValueOnce(pgError);

    const res = await request(makeApp()).delete('/api/auth/users/9');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Não foi possível desativar o usuário');
  });

  it('nao devolve a mensagem crua do Postgres ao listar usuários', async () => {
    mocks.listUsers.mockRejectedValueOnce(pgError);

    const res = await request(makeApp()).get('/api/auth/users');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Não foi possível listar os usuários');
  });

  /**
   * Este teste antes exigia 401 "Credenciais inválidas" para uma queda do
   * Postgres — congelava o defeito. Nao vazava detalhe, mas mentia sobre a
   * causa: quem estava na tela redigitava a senha enquanto o banco estava fora.
   * A asercao de nao-vazamento continua; o status esperado passa a ser 500.
   */
  it('falha de infraestrutura no login sai 500 generico, sem detalhe do driver', async () => {
    mocks.login.mockRejectedValueOnce(
      new Error('connect ECONNREFUSED 10.0.0.9:5432 — database "importacao"'),
    );

    const res = await request(makeApp())
      .post('/api/auth/login')
      .send({ email: 'a@grupounico.com', password: 'x' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe(
      'Não foi possível concluir o login agora. Tente novamente em alguns minutos.',
    );
    expect(res.body.error).not.toContain('10.0.0.9');
    expect(res.body.error).not.toContain('5432');
    expect(res.body.error).not.toContain('ECONNREFUSED');
    expect(res.body.error).not.toContain('importacao');
    // O ponto do conserto: infraestrutura nao pode se passar por credencial.
    expect(res.body.error).not.toContain('Credenciais');
  });

  it('credencial errada continua saindo 401 com a mensagem de produto', async () => {
    mocks.login.mockRejectedValueOnce(new UnauthorizedError('Credenciais inválidas'));

    const res = await request(makeApp())
      .post('/api/auth/login')
      .send({ email: 'a@grupounico.com', password: 'errada' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Credenciais inválidas');
  });

  it('token Google invalido sai 401; queda do banco no mesmo endpoint sai 500', async () => {
    mocks.loginWithGoogle.mockRejectedValueOnce(new UnauthorizedError('Token Google inválido'));

    const invalido = await request(makeApp()).post('/api/auth/google').send({ credential: 'tok' });

    expect(invalido.status).toBe(401);
    expect(invalido.body.error).toBe('Token Google inválido');

    mocks.loginWithGoogle.mockRejectedValueOnce(
      new Error('connect ECONNREFUSED 10.0.0.9:5432 — database "importacao"'),
    );

    const infra = await request(makeApp()).post('/api/auth/google').send({ credential: 'tok' });

    expect(infra.status).toBe(500);
    expect(infra.body.error).not.toContain('10.0.0.9');
    expect(infra.body.error).not.toContain('Token Google');
  });

  it('preserva mensagem e status de AppError (mensagem de produto)', async () => {
    mocks.loginWithGoogle.mockRejectedValueOnce(
      new ForbiddenError('Acesso restrito a contas @grupounico.com'),
    );

    const res = await request(makeApp()).post('/api/auth/google').send({ credential: 'tok' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Acesso restrito a contas @grupounico.com');
  });
});

describe('authController — guarda de auto-bloqueio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authGate.id = 7;
    authGate.role = 'admin';
  });

  it('propaga o ator e o IP para o service em update', async () => {
    mocks.updateUser.mockResolvedValueOnce({ id: 9 });

    await request(makeApp()).put('/api/auth/users/9').send({ role: 'analyst' });

    expect(mocks.updateUser).toHaveBeenCalledWith(
      9,
      { role: 'analyst' },
      expect.objectContaining({ id: 7 }),
    );
  });

  it('propaga o ator e o IP para o service em delete', async () => {
    mocks.deleteUser.mockResolvedValueOnce({ id: 9 });

    await request(makeApp()).delete('/api/auth/users/9');

    expect(mocks.deleteUser).toHaveBeenCalledWith(9, expect.objectContaining({ id: 7 }));
  });

  it('propaga o ator para o service em create', async () => {
    mocks.createUser.mockResolvedValueOnce({ id: 9 });

    await request(makeApp()).post('/api/auth/users').send({ name: 'X' });

    expect(mocks.createUser).toHaveBeenCalledWith(
      { name: 'X' },
      expect.objectContaining({ id: 7 }),
    );
  });

  it('devolve 409 quando o service recusa a auto-desativação', async () => {
    mocks.updateUser.mockRejectedValueOnce(
      new ConflictError('Você não pode desativar a própria conta. Peça a outro administrador.'),
    );

    const res = await request(makeApp()).put('/api/auth/users/7').send({ isActive: false });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('não pode desativar a própria conta');
  });

  it('devolve 409 quando o service recusa desativar o último administrador', async () => {
    mocks.deleteUser.mockRejectedValueOnce(
      new ConflictError('Não é possível desativar o último administrador ativo.'),
    );

    const res = await request(makeApp()).delete('/api/auth/users/5');

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('último administrador ativo');
  });
});
