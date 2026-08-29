import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/shared/hooks/useApi', () => ({ useApiQuery: vi.fn() }));

import { useApiQuery } from '@/shared/hooks/useApi';
import { ComunicacoesTab } from './ComunicacoesTab';

const PROCESS_ID = '7';

type QueryState = { data?: unknown; error?: unknown };

function mockQueries(main: QueryState, secondary: Record<string, QueryState> = {}) {
  vi.mocked(useApiQuery).mockImplementation(((key: readonly unknown[]) => {
    const state =
      key[0] === 'communications' ? main : (secondary[String(key[0])] ?? { data: undefined });
    return {
      data: state.data,
      isLoading: false,
      isError: Boolean(state.error),
      error: state.error ?? null,
      refetch: vi.fn(),
    };
  }) as unknown as typeof useApiQuery);
}

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ComunicacoesTab processId={PROCESS_ID} />
    </QueryClientProvider>,
  );
}

describe('ComunicacoesTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mostra o estado vazio quando a consulta funcionou e nao ha atendimento', () => {
    mockQueries({ data: { data: [], pagination: {} } });
    renderTab();
    expect(screen.getByText('Nenhum atendimento registrado.')).toBeInTheDocument();
  });

  it('mostra erro com retry em vez de "Nenhum atendimento" quando a carga falha', () => {
    // Antes o erro era engolido: o operador concluia que nao ha e-mail pendente
    // para o fornecedor quando na verdade a chamada falhou.
    mockQueries({ error: new Error('Network request failed') });
    renderTab();

    expect(screen.queryByText('Nenhum atendimento registrado.')).not.toBeInTheDocument();
    expect(screen.getByText(/Erro ao carregar os atendimentos deste processo/)).toBeInTheDocument();
  });

  it('avisa que as assinaturas falharam em vez de simplesmente sumir com o seletor', () => {
    mockQueries(
      {
        data: {
          data: [
            {
              id: 1,
              processId: 7,
              recipient: 'Fornecedor',
              recipientEmail: 'f@x.com',
              subject: 'Assunto',
              body: 'Corpo',
              status: 'draft',
              sentAt: null,
              createdAt: '2026-03-15T12:00:00.000Z',
              errorMessage: null,
              attachments: [],
            },
          ],
          pagination: {},
        },
      },
      { 'email-signatures': { error: new Error('boom') } },
    );
    renderTab();

    expect(screen.getByText(/Nao foi possivel carregar as assinaturas/)).toBeInTheDocument();
  });
});
