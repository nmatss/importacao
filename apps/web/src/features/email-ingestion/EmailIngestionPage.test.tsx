import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MockAuthProvider, mockUser } from '@/test/mocks/auth';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/shared/lib/api-client', () => ({ api: { post: vi.fn() } }));
vi.mock('@/shared/hooks/useApi', () => ({ useApiQuery: vi.fn() }));

import { useApiQuery } from '@/shared/hooks/useApi';
import { EmailIngestionPage } from './EmailIngestionPage';

const mockedUseApiQuery = vi.mocked(useApiQuery);

const status = {
  enabled: true,
  method: 'gmail_api',
  gmailConfigured: true,
  imapConfigured: false,
  sharedMailbox: 'importacao@grupounico.com',
  allowedSenders: 'fenicia',
  lastRun: '2026-08-28T10:00:00.000Z',
  todayStats: [{ status: 'failed', count: 3 }],
};

const logs = {
  data: [
    {
      id: 10,
      messageId: 'abc',
      fromAddress: 'bruna@feniciacomex.com.br',
      subject: 'Documentos',
      receivedAt: '2026-08-28T09:00:00.000Z',
      processId: null,
      status: 'failed',
      attachmentsCount: 1,
      processedAttachments: 0,
      errorMessage: 'Falha ao classificar',
      processCode: null,
      createdAt: '2026-08-28T09:00:00.000Z',
    },
  ],
  pagination: { page: 1, limit: 20, total: 1, pages: 1 },
};

function renderPage(role: 'admin' | 'analyst') {
  mockedUseApiQuery.mockImplementation(((_key: unknown, url: string) => ({
    data: url.startsWith('/api/email-ingestion/status') ? status : logs,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  })) as unknown as typeof useApiQuery);

  return render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <MockAuthProvider value={{ user: { ...mockUser, role } }}>
          <EmailIngestionPage />
        </MockAuthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/**
 * Regressao: os tres controles chamam endpoints admin-only, mas eram renderizados
 * para todo mundo. O analista clicava e recebia "Acesso restrito a
 * administradores".
 */
describe('EmailIngestionPage acoes admin-only', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('esconde Verificar Novos, Buscar Todos e Reprocessar do analista', () => {
    renderPage('analyst');

    expect(screen.queryByRole('button', { name: /Verificar Novos/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Buscar Todos/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reprocessar/i })).not.toBeInTheDocument();
    // A leitura do log continua disponivel para o analista.
    expect(screen.getByText('Documentos')).toBeInTheDocument();
  });

  it('mantem os tres controles para o admin', () => {
    renderPage('admin');

    expect(screen.getByRole('button', { name: /Verificar Novos/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Buscar Todos/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reprocessar/i })).toBeInTheDocument();
  });
});
