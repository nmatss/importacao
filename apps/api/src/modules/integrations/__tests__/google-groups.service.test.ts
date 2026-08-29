import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regressao do incidente de 07-14/08/2026: a API ficou sem saida para a
 * internet e a checagem de grupo passou a estourar ETIMEDOUT em toda tentativa
 * de login. Sem cache e sem sobrevida, isso trancou todo mundo para fora.
 */

const { mockRequest, store } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  store: new Map<string, string>(),
}));

vi.mock('google-auth-library', () => ({
  JWT: class {
    request = (...args: any[]) => mockRequest(...args);
  },
}));

vi.mock('../../../shared/cache/redis.js', () => ({
  cache: {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => {
      store.set(key, value);
    },
    del: async (key: string) => {
      store.delete(key);
    },
  },
}));

process.env.GOOGLE_DRIVE_CLIENT_EMAIL = 'sa@projeto.iam.gserviceaccount.com';
process.env.GOOGLE_DRIVE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----';
process.env.GOOGLE_ADMIN_EMAIL = 'admin@grupounico.com';
process.env.GOOGLE_GROUP_ALLOWED = 'importacao@grupounico.com';

const { googleGroupsService } = await import('../google-groups.service.js');
const { ServiceUnavailableError } = await import('../../../shared/errors/index.js');

const timeout = () => Object.assign(new Error('socket hang up'), { code: 'ETIMEDOUT' });
const member = { data: { isMember: true } };

describe('googleGroupsService.isAllowed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
  });

  it('nao chama o Google de novo enquanto a resposta esta fresca', async () => {
    mockRequest.mockResolvedValue(member);

    expect(await googleGroupsService.isAllowed('ana@grupounico.com')).toBe(true);
    expect(await googleGroupsService.isAllowed('ana@grupounico.com')).toBe(true);

    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('mantem quem ja foi validado quando o Google fica inalcancavel', async () => {
    mockRequest.mockResolvedValueOnce(member);
    await googleGroupsService.isAllowed('ana@grupounico.com');

    // Expira o trecho "fresco", preservando a sobrevida.
    const key = 'google-groups:importacao@grupounico.com:ana@grupounico.com';
    store.set(key, JSON.stringify({ freshUntil: Date.now() - 1 }));

    mockRequest.mockRejectedValue(timeout());

    expect(await googleGroupsService.isAllowed('ana@grupounico.com')).toBe(true);
  });

  it('devolve indisponibilidade (nao "acesso negado") para quem nao tem cache', async () => {
    mockRequest.mockRejectedValue(timeout());

    await expect(googleGroupsService.isAllowed('nova@grupounico.com')).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
  });

  it('404 do Google continua sendo "nao e membro"', async () => {
    mockRequest.mockRejectedValue(
      Object.assign(new Error('Not Found'), { response: { status: 404 } }),
    );

    expect(await googleGroupsService.isAllowed('externo@grupounico.com')).toBe(false);
  });

  /**
   * `hasMember` e GET puro. Um 503 de dois segundos do admin.googleapis.com nao
   * pode virar login recusado nem consumir a sobrevida de quem nunca logou.
   */
  it('um 503 transitorio e re-tentado em vez de trancar o login', async () => {
    mockRequest
      .mockRejectedValueOnce(
        Object.assign(new Error('backend error'), { response: { status: 503 } }),
      )
      .mockResolvedValueOnce(member);

    expect(await googleGroupsService.isAllowed('nova2@grupounico.com')).toBe(true);
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('404 e 403 NAO sao re-tentados — sao resposta definitiva', async () => {
    mockRequest.mockRejectedValue(
      Object.assign(new Error('Not Found'), { response: { status: 404 } }),
    );

    expect(await googleGroupsService.isAllowed('externo2@grupounico.com')).toBe(false);
    expect(mockRequest).toHaveBeenCalledTimes(1);

    mockRequest.mockClear();
    mockRequest.mockRejectedValue(
      Object.assign(new Error('Forbidden'), { response: { status: 403 } }),
    );

    await expect(googleGroupsService.isAllowed('externo3@grupounico.com')).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('remover do grupo derruba a sobrevida junto', async () => {
    mockRequest.mockResolvedValueOnce(member);
    await googleGroupsService.isAllowed('saiu@grupounico.com');

    const key = 'google-groups:importacao@grupounico.com:saiu@grupounico.com';
    store.set(key, JSON.stringify({ freshUntil: Date.now() - 1 }));

    mockRequest.mockResolvedValueOnce({ data: { isMember: false } });
    expect(await googleGroupsService.isAllowed('saiu@grupounico.com')).toBe(false);
    expect(store.has(key)).toBe(false);

    // E agora, com o Google fora, ele nao volta a entrar pela sobrevida.
    mockRequest.mockRejectedValue(timeout());
    await expect(googleGroupsService.isAllowed('saiu@grupounico.com')).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
  });
});
