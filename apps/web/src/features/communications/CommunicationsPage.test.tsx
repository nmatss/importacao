import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { settingsKeys } from '@/shared/api/query-keys';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/shared/lib/api-client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

// `useApiMutation` fica REAL: o defeito do "Salvar rascunho" estava justamente
// nas callbacks passadas para ele.
vi.mock('@/shared/hooks/useApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/hooks/useApi')>();
  return { ...actual, useApiQuery: vi.fn() };
});

import { toast } from 'sonner';
import { api } from '@/shared/lib/api-client';
import { useApiQuery } from '@/shared/hooks/useApi';
import { CommunicationsPage } from './CommunicationsPage';

const mockedUseApiQuery = vi.mocked(useApiQuery);
const mockedApi = vi.mocked(api);

const processes = [{ id: 1, processCode: 'IM001', brand: 'Puket' }];

let commPagination = { page: 1, limit: 50, total: 1, pages: 1 };
const communications = [
  {
    id: 99,
    processId: 1,
    recipient: 'Bruna',
    recipientEmail: 'bruna@feniciacomex.com.br',
    subject: 'Documentos',
    body: 'Segue.',
    attachments: null,
    status: 'sent',
    createdAt: '2026-08-20T10:00:00.000Z',
    sentAt: '2026-08-20T10:01:00.000Z',
  },
];

function setupQueries() {
  mockedUseApiQuery.mockImplementation(((_key: unknown, url: string) => {
    if (url.startsWith('/api/settings/email-signatures')) {
      return { data: [], isLoading: false, error: null, refetch: vi.fn() };
    }
    if (url.startsWith('/api/settings/communication-templates')) {
      return { data: [], isLoading: false, error: null, refetch: vi.fn() };
    }
    if (url.startsWith('/api/processes')) {
      return {
        data: { data: processes, pagination: {} },
        isLoading: false,
        isFetching: false,
        error: null,
        refetch: vi.fn(),
      };
    }
    if (url.startsWith('/api/documents/process/')) {
      return { data: [], isLoading: false, error: null, refetch: vi.fn() };
    }
    if (url.startsWith('/api/communications')) {
      return {
        data: { data: communications, pagination: commPagination },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      };
    }
    return { data: undefined, isLoading: false, error: null, refetch: vi.fn() };
  }) as unknown as typeof useApiQuery);
}

function renderPage() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <CommunicationsPage />
    </QueryClientProvider>,
  );
}

/** Preenche o composer ate `isFormValid` ficar verdadeiro. */
async function fillComposer() {
  const processInput = screen.getByLabelText('Processo');
  // O processo so casa depois que o debounce libera a lista de opcoes.
  fireEvent.change(processInput, { target: { value: 'IM' } });
  await waitFor(() =>
    expect(document.querySelectorAll('#comm-process-list option').length).toBeGreaterThan(0),
  );
  fireEvent.change(processInput, { target: { value: 'IM001 - Puket' } });

  fireEvent.change(screen.getByLabelText('Destinatário'), { target: { value: 'Bruna' } });
  fireEvent.change(screen.getByLabelText('E-mail'), {
    target: { value: 'bruna@feniciacomex.com.br' },
  });
  fireEvent.change(screen.getByLabelText('Assunto'), { target: { value: 'Assunto' } });
  fireEvent.change(screen.getByLabelText('Mensagem'), { target: { value: 'Corpo' } });
}

describe('CommunicationsPage — salvar rascunho', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commPagination = { page: 1, limit: 50, total: 1, pages: 1 };
    setupQueries();
  });

  /**
   * Regressao: a mutation de criacao definia `onSuccess` mas nao `onError`, e o
   * caminho de criacao chamava `.mutate()` sem tratamento. Um 422/400/500 saia do
   * estado pendente e nada aparecia na tela.
   */
  it('mostra o erro quando o POST do rascunho falha', async () => {
    mockedApi.post.mockRejectedValueOnce(new Error('Destinatário é obrigatório'));
    renderPage();
    await fillComposer();

    const saveButton = screen.getByRole('button', { name: /Salvar rascunho/ });
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.click(saveButton);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Destinatário é obrigatório'));
  });

  it('confirma o sucesso quando o POST do rascunho funciona', async () => {
    mockedApi.post.mockResolvedValueOnce({ id: 1 });
    renderPage();
    await fillComposer();

    const saveButton = screen.getByRole('button', { name: /Salvar rascunho/ });
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.click(saveButton);

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Rascunho salvo'));
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('CommunicationsPage — histórico paginado', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commPagination = { page: 1, limit: 50, total: 1, pages: 1 };
    setupQueries();
  });

  /**
   * Regressao: a tela pedia limit=100 sem `page` e sem controles — a partir do
   * atendimento 101 o historico ficava invisivel de forma permanente. E o badge
   * de contagem usava o tamanho da pagina, nao o total.
   */
  it('pede a página e usa o total da API na contagem', async () => {
    commPagination = { page: 1, limit: 50, total: 250, pages: 5 };
    renderPage();

    const listUrl = mockedUseApiQuery.mock.calls
      .map(([, url]) => url)
      .find((url) => url.startsWith('/api/communications'));
    expect(listUrl).toContain('page=1');
    expect(listUrl).toContain('limit=50');

    expect(screen.getByText('250')).toBeInTheDocument();
    expect(screen.getByText(/Página 1 de 5/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));

    await waitFor(() =>
      expect(
        mockedUseApiQuery.mock.calls
          .map(([, url]) => url)
          .some((url) => url.startsWith('/api/communications') && url.includes('page=2')),
      ).toBe(true),
    );
  });

  it('não mostra controles de paginação com uma página só', () => {
    renderPage();

    expect(screen.queryByRole('button', { name: 'Próxima' })).not.toBeInTheDocument();
  });
});

describe('CommunicationsPage — cache dos modelos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupQueries();
  });

  /**
   * Regressao: esta tela usava `['communication-templates']` e Configuracoes usava
   * `['settings','communication-templates']`. As invalidacoes de Configuracoes nao
   * alcancavam esta chave: um modelo novo so aparecia depois do staleTime, e um
   * modelo desativado seguia clicavel nessa janela.
   */
  it('lê os modelos sob o prefixo compartilhado com Configurações', () => {
    renderPage();

    const call = mockedUseApiQuery.mock.calls.find(
      ([, url]) => url === '/api/settings/communication-templates',
    );
    expect(call).toBeDefined();
    const prefix = settingsKeys.communicationTemplates();
    expect((call![0] as unknown[]).slice(0, prefix.length)).toEqual([...prefix]);
  });
});
