import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MockAuthProvider, mockUser } from '@/test/mocks/auth';
import { settingsKeys } from '@/shared/api/query-keys';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/shared/lib/api-client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock('@/shared/hooks/useApi', () => ({ useApiQuery: vi.fn() }));

import { useApiQuery } from '@/shared/hooks/useApi';
import { SettingsPage } from './SettingsPage';

const mockedUseApiQuery = vi.mocked(useApiQuery);

const users = [
  { id: 1, name: 'Admin Um', email: 'admin@grupounico.com', role: 'admin', isActive: true },
  { id: 2, name: 'Analista Dois', email: 'ana@grupounico.com', role: 'analyst', isActive: true },
];

/** Respostas por URL; `overrides` troca uma delas por um estado de erro. */
function setupQueries(overrides: Record<string, unknown> = {}) {
  const byUrl: Record<string, unknown> = {
    '/api/auth/users': users,
    '/api/settings/smtp': [],
    '/api/settings/recipients': [],
    '/api/settings/integrations': [],
    '/api/settings/email-signatures': [],
    '/api/settings/communication-templates?active=false': [],
    '/api/settings/google_chat_webhook_url': null,
  };

  mockedUseApiQuery.mockImplementation(((_key: unknown, url: string) => {
    if (url in overrides) return overrides[url];
    return { data: byUrl[url], isLoading: false, error: null, refetch: vi.fn() };
  }) as unknown as typeof useApiQuery);
}

function renderSettings(currentUserId = '1') {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MockAuthProvider value={{ user: { ...mockUser, id: currentUserId, role: 'admin' } }}>
        <SettingsPage />
      </MockAuthProvider>
    </QueryClientProvider>,
  );
}

async function openTab(name: RegExp) {
  await userEvent.click(screen.getByRole('button', { name }));
}

describe('SettingsPage — aba Usuários', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Regressao: os controles eram renderizados para TODAS as linhas, inclusive a
   * do proprio usuario logado. Desativando a si mesmo o admin era deslogado na
   * requisicao seguinte; sendo o ultimo admin, so SQL direto recuperava.
   */
  it('desabilita o switch e o botão de desativar na própria linha', async () => {
    setupQueries();
    renderSettings('1');
    await openTab(/Usuários/);

    const selfSwitch = screen.getByRole('switch', { name: 'Desativar Admin Um' });
    const selfDeactivate = screen.getByRole('button', { name: 'Desativar usuário Admin Um' });
    expect(selfSwitch).toBeDisabled();
    expect(selfDeactivate).toBeDisabled();
    expect(selfSwitch).toHaveAttribute('title', 'Você não pode desativar a própria conta.');
    expect(selfDeactivate).toHaveAttribute('title', 'Você não pode desativar a própria conta.');
  });

  it('mantém os controles habilitados nas linhas dos outros usuários', async () => {
    setupQueries();
    renderSettings('1');
    await openTab(/Usuários/);

    expect(screen.getByRole('switch', { name: 'Desativar Analista Dois' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Desativar usuário Analista Dois' })).toBeEnabled();
  });

  /** Regressao: em falha a aba mostrava "0 usuários cadastrados" e tabela vazia. */
  it('mostra erro em vez de "0 usuários cadastrados" quando a query falha', async () => {
    setupQueries({
      '/api/auth/users': {
        data: undefined,
        isLoading: false,
        error: new Error('boom'),
        refetch: vi.fn(),
      },
    });
    renderSettings('1');
    await openTab(/Usuários/);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Não foi possível carregar os usuários.')).toBeInTheDocument();
    expect(screen.queryByText(/usuários cadastrados/)).not.toBeInTheDocument();
  });
});

describe('SettingsPage — abas de Modelos e Assinaturas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Regressao: em falha aparecia "Nenhum modelo cadastrado." */
  it('mostra erro em vez de "Nenhum modelo cadastrado"', async () => {
    setupQueries({
      '/api/settings/communication-templates?active=false': {
        data: undefined,
        isLoading: false,
        error: new Error('boom'),
        refetch: vi.fn(),
      },
    });
    renderSettings();
    await openTab(/Modelos/);

    expect(
      screen.getByText('Não foi possível carregar os modelos de atendimento.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Nenhum modelo cadastrado.')).not.toBeInTheDocument();
  });

  /**
   * Regressao: o pior dos quatro casos — em falha a tela dizia "Nenhuma
   * assinatura cadastrada" e convidava a criar outra, levando a duplicatas.
   */
  it('mostra erro em vez de convidar a criar a primeira assinatura', async () => {
    setupQueries({
      '/api/settings/email-signatures': {
        data: undefined,
        isLoading: false,
        error: new Error('boom'),
        refetch: vi.fn(),
      },
    });
    renderSettings();
    await openTab(/Assinaturas/);

    expect(
      screen.getByText('Não foi possível carregar as assinaturas de e-mail.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Nenhuma assinatura cadastrada.')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Criar primeira assinatura/ }),
    ).not.toBeInTheDocument();
  });

  /**
   * Regressao: Configuracoes usava `['settings','communication-templates']` e
   * Atendimentos usava `['communication-templates']`; as invalidacoes daqui nunca
   * chegavam la. Agora as duas chaves compartilham o mesmo prefixo.
   */
  it('lê os modelos com uma chave sob o prefixo compartilhado com Atendimentos', async () => {
    setupQueries();
    renderSettings();
    await openTab(/Modelos/);

    const call = mockedUseApiQuery.mock.calls.find(
      ([, url]) => url === '/api/settings/communication-templates?active=false',
    );
    expect(call).toBeDefined();
    const prefix = settingsKeys.communicationTemplates();
    expect((call![0] as unknown[]).slice(0, prefix.length)).toEqual([...prefix]);
  });
});
