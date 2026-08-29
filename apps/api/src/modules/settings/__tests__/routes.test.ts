import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authGate = vi.hoisted(() => ({ adminAllowed: true }));
const settingsStore = vi.hoisted(() => new Map<string, string>());
const mockVerifySmtpConnection = vi.hoisted(() => vi.fn());

vi.mock('../../../shared/mail/mailer.js', () => ({
  verifySmtpConnection: (...args: any[]) => mockVerifySmtpConnection(...args),
}));

vi.mock('../../../shared/middleware/auth.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 1, role: 'admin' };
    next();
  },
  adminMiddleware: (_req: any, res: any, next: any) => {
    if (!authGate.adminAllowed) {
      return res.status(403).json({ success: false, error: 'Acesso negado' });
    }
    next();
  },
}));

vi.mock('../service.js', () => ({
  settingsService: {
    get: vi.fn(async (key: string) => {
      if (!settingsStore.has(key)) return undefined;
      return { id: 1, key, value: settingsStore.get(key), description: null };
    }),
    set: vi.fn(async (key: string, value: string) => {
      settingsStore.set(key, value);
      return { id: 1, key, value, description: null };
    }),
    getAll: vi.fn(async () =>
      [...settingsStore.entries()].map(([key, value], index) => ({
        id: index + 1,
        key,
        value,
        description: null,
      })),
    ),
    getCommunicationTemplates: vi.fn(async () => [{ id: 1, name: 'Cobranca', isActive: true }]),
    createCommunicationTemplate: vi.fn(async (_userId: number | null, body: any) => ({
      id: 2,
      ...body,
    })),
    updateCommunicationTemplate: vi.fn(async (id: number, _userId: number | null, body: any) => ({
      id,
      ...body,
    })),
    deleteCommunicationTemplate: vi.fn(async (id: number) => ({ id })),
  },
}));

vi.mock('../../integrations/google-drive.service.js', () => ({
  googleDriveService: {
    isConfigured: vi.fn().mockResolvedValue(false),
    isRootConfigured: vi.fn().mockResolvedValue(false),
    listProcessFiles: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../integrations/odoo.service.js', () => ({
  odooService: {
    isConfigured: vi.fn().mockResolvedValue(false),
    authenticate: vi.fn().mockResolvedValue(1),
  },
}));

const { settingsRoutes } = await import('../routes.js');
const { settingsService } = await import('../service.js');
const { googleDriveService } = await import('../../integrations/google-drive.service.js');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/settings', settingsRoutes);
  return app;
}

describe('settingsRoutes recipients', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    settingsStore.clear();
    authGate.adminAllowed = true;
    process.env = { ...originalEnv };
    mockVerifySmtpConnection.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('requires admin access for recipient settings', async () => {
    authGate.adminAllowed = false;

    const res = await request(makeApp()).get('/api/settings/recipients');

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('normalizes and persists recipient lists', async () => {
    const res = await request(makeApp()).put('/api/settings/recipients').send({
      kiom_email: ' Contact@KIOMGlobal.com\ncontact@kiomglobal.com ',
      fenicia_email: 'bruna@feniciacomex.com.br; fenicia.fin@feniciacomex.com.br',
      isa_email: '',
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(
      expect.arrayContaining([
        { key: 'kiom_email', value: 'contact@kiomglobal.com' },
        {
          key: 'fenicia_email',
          value: 'bruna@feniciacomex.com.br, fenicia.fin@feniciacomex.com.br',
        },
        { key: 'isa_email', value: '' },
      ]),
    );
    expect(settingsStore.get('kiom_email')).toBe('contact@kiomglobal.com');
  });

  it('rejects invalid recipient lists', async () => {
    const res = await request(makeApp()).put('/api/settings/recipients').send({
      kiom_email: 'contact@kiomglobal.com, invalido',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Dados inválidos');
  });

  it('blocks reserved recipient keys on the generic setting endpoint', async () => {
    const res = await request(makeApp())
      .put('/api/settings/kiom_email')
      .send({ value: 'bypass@example.com' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('/api/settings/recipients');
    expect(settingsStore.has('kiom_email')).toBe(false);
  });

  it('uses env fallback only when a recipient key has not been saved', async () => {
    process.env.KIOM_EMAIL = 'contact@kiomglobal.com';

    const res = await request(makeApp()).get('/api/settings/recipients');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(
      expect.arrayContaining([{ key: 'kiom_email', value: 'contact@kiomglobal.com' }]),
    );
  });

  it('tests SMTP authentication without sending an e-mail', async () => {
    const res = await request(makeApp()).post('/api/settings/smtp/test');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ connected: true });
    expect(mockVerifySmtpConnection).toHaveBeenCalledOnce();
  });

  it('rejects an invalid SMTP port and sender before persisting them', async () => {
    const res = await request(makeApp()).put('/api/settings/smtp').send({
      smtp_port: '70000',
      smtp_from: '"Uni.co" <global@grupounico.com>Bcc: attacker@evil.test',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Dados inválidos');
    expect(settingsStore.has('smtp_port')).toBe(false);
    expect(settingsStore.has('smtp_from')).toBe(false);
  });

  it('returns an actionable message when SMTP authentication is refused', async () => {
    mockVerifySmtpConnection.mockRejectedValue(
      Object.assign(new Error('provider details'), { code: 'EAUTH' }),
    );

    const res = await request(makeApp()).post('/api/settings/smtp/test');

    expect(res.status).toBe(503);
    expect(res.body.error).toContain('Autenticação SMTP recusada');
    expect(res.body.error).not.toContain('provider details');
  });
});

/**
 * Os modelos de comunicacao sao uma tabela GLOBAL e o service nao verifica dono
 * nem papel. Ate 29/08 as tres rotas de escrita estavam registradas ANTES do
 * `router.use(adminMiddleware)`, entao qualquer analista autenticado podia
 * reescrever ou desativar o modelo que outra pessoa usa para falar com
 * KIOM/Fenicia/ISA. (As assinaturas de e-mail, ao lado, sao por usuario e o
 * service confere posse — a assimetria era acidental.)
 */
describe('settingsRoutes communication templates', () => {
  beforeEach(() => {
    settingsStore.clear();
    authGate.adminAllowed = true;
  });

  it('mantem a LEITURA aberta a qualquer autenticado', async () => {
    authGate.adminAllowed = false;

    const res = await request(makeApp()).get('/api/settings/communication-templates');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ id: 1, name: 'Cobranca', isActive: true }]);
  });

  it('devolve 403 para analista ao criar modelo', async () => {
    authGate.adminAllowed = false;

    const res = await request(makeApp())
      .post('/api/settings/communication-templates')
      .send({ name: 'Novo', subject: 'Assunto', body: 'Corpo' });

    expect(res.status).toBe(403);
  });

  it('devolve 403 para analista ao atualizar modelo', async () => {
    authGate.adminAllowed = false;

    const res = await request(makeApp())
      .put('/api/settings/communication-templates/1')
      .send({ name: 'Editado' });

    expect(res.status).toBe(403);
  });

  it('devolve 403 para analista ao remover modelo', async () => {
    authGate.adminAllowed = false;

    const res = await request(makeApp()).delete('/api/settings/communication-templates/1');

    expect(res.status).toBe(403);
  });

  it('continua permitindo a escrita para administrador', async () => {
    const res = await request(makeApp()).delete('/api/settings/communication-templates/1');

    expect(res.status).toBe(200);
  });
});

describe('settingsController — mensagens de erro', () => {
  beforeEach(() => {
    settingsStore.clear();
    authGate.adminAllowed = true;
    vi.clearAllMocks();
  });

  it('preserva a mensagem de produto do service (contrato statusCode 4xx)', async () => {
    // `settings/service.ts` nao usa AppError: sinaliza com
    // `Object.assign(new Error(msg), { statusCode })`.
    vi.mocked(settingsService.deleteCommunicationTemplate).mockRejectedValueOnce(
      Object.assign(new Error('Modelo nao encontrado'), { statusCode: 404 }),
    );

    const res = await request(makeApp()).delete('/api/settings/communication-templates/1');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Modelo nao encontrado');
  });

  it('nao devolve a mensagem crua do Postgres', async () => {
    vi.mocked(settingsService.getAll).mockRejectedValueOnce(
      new Error(
        'duplicate key value violates unique constraint "settings_key_unique" — host=db.internal port=5432',
      ),
    );

    const res = await request(makeApp()).get('/api/settings');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Não foi possível carregar as configurações');
    expect(res.body.error).not.toContain('settings_key_unique');
    expect(res.body.error).not.toContain('db.internal');
  });

  it('nao devolve detalhe cru do provedor no teste de conexão com o Drive', async () => {
    vi.mocked(googleDriveService.isRootConfigured).mockResolvedValueOnce(true);
    vi.mocked(googleDriveService.listProcessFiles).mockRejectedValueOnce(
      new Error('invalid_grant: account svc@projeto.iam.gserviceaccount.com not authorized'),
    );
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = 'folder-1';

    const res = await request(makeApp()).post('/api/settings/integrations/test-drive');

    expect(res.body.error).toBe('Falha na conexão com Google Drive');
    expect(res.body.error).not.toContain('gserviceaccount.com');
  });
});
