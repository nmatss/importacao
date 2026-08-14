import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockRedirect } = vi.hoisted(() => ({ mockRedirect: vi.fn() }));

vi.mock('./session-expired', () => ({
  redirectToLogin: mockRedirect,
  consumeReturnTo: vi.fn(() => null),
}));

const { api } = await import('./api-client');

const TOKEN_KEY = 'importacao_token';

function respond(status: number, body: unknown) {
  return Promise.resolve({
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
  } as Response);
}

describe('api-client — 401 e sessao expirada', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem(TOKEN_KEY, 'token-antigo');
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('trata 401 de rota comum como sessao expirada', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => respond(401, { error: 'Token inválido' })),
    );

    await expect(api.get('/api/processes')).rejects.toThrow('Unauthorized');

    expect(mockRedirect).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('NAO trata 401 do proprio login Google como sessao expirada', async () => {
    // Sem isso a pagina recarregava em /login?expired=1 antes de o LoginPage
    // mostrar o motivo — o operador lia "sua sessao expirou" em loop
    // (incidente de 13-14/08/2026).
    vi.stubGlobal(
      'fetch',
      vi.fn(() => respond(401, { error: 'Token Google inválido' })),
    );

    await expect(api.post('/api/auth/google', { credential: 'x' })).rejects.toThrow(
      'Token Google inválido',
    );

    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('propaga o motivo real quando o Google esta fora do ar (503)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        respond(503, {
          error: 'Nao foi possivel falar com o Google agora. Tente novamente em alguns minutos.',
        }),
      ),
    );

    await expect(api.post('/api/auth/google', { credential: 'x' })).rejects.toThrow(/Google agora/);

    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('nao trata 401 do login por senha como sessao expirada', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => respond(401, { error: 'Credenciais inválidas' })),
    );

    await expect(api.post('/api/auth/login', { email: 'a', password: 'b' })).rejects.toThrow(
      'Credenciais inválidas',
    );

    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
