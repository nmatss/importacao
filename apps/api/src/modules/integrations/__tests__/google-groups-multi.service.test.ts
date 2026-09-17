import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * O portal operacional usa importacao.aut@grupounico.com. Quem so esta nesse
 * grupo nao pode ser recusado porque a API ainda consulta so o grupo legado.
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
process.env.GOOGLE_GROUP_ALLOWED = 'importacao.aut@grupounico.com,importacao@grupounico.com';

const { googleGroupsService } = await import('../google-groups.service.js');

const notMember = Object.assign(new Error('Not Found'), { response: { status: 404 } });
const member = { data: { isMember: true } };

describe('googleGroupsService.isAllowed — lista de grupos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
  });

  it('aceita quem esta no grupo Portal Importacao (importacao.aut)', async () => {
    mockRequest.mockResolvedValueOnce(member);

    expect(await googleGroupsService.isAllowed('isabela.hochheim@imaginarium.com.br')).toBe(true);
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(String(mockRequest.mock.calls[0][0].url)).toContain(
      encodeURIComponent('importacao.aut@grupounico.com'),
    );
  });

  it('aceita quem esta so no grupo legado', async () => {
    mockRequest.mockRejectedValueOnce(notMember).mockResolvedValueOnce(member);

    expect(await googleGroupsService.isAllowed('ana@grupounico.com')).toBe(true);
    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(String(mockRequest.mock.calls[1][0].url)).toContain(
      encodeURIComponent('importacao@grupounico.com'),
    );
  });

  it('recusa quando a pessoa nao esta em nenhum grupo da lista', async () => {
    mockRequest.mockRejectedValue(notMember);

    expect(await googleGroupsService.isAllowed('fora@grupounico.com')).toBe(false);
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });
});
