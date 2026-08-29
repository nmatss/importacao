import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/shared/lib/api-client', () => ({ api: { get: vi.fn(), patch: vi.fn() } }));
vi.mock('@/shared/hooks/useApi', () => ({ useApiQuery: vi.fn() }));

import { useApiQuery } from '@/shared/hooks/useApi';
import { AlertsPage } from './AlertsPage';

const mockedUseApiQuery = vi.mocked(useApiQuery);

const baseAlert = {
  id: 1,
  processId: null,
  processCode: null,
  severity: 'critical' as const,
  title: 'Processo Parado',
  message: 'Sem movimentacao ha 10 dias.',
  acknowledged: false,
  acknowledgedBy: null,
  acknowledgedAt: null,
  createdAt: '2026-08-20T12:00:00.000Z',
};

function renderAlerts(alerts: unknown[]) {
  mockedUseApiQuery.mockReturnValue({
    data: { data: alerts, pagination: { total: alerts.length, pages: 1, page: 1 } },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useApiQuery>);

  return render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <AlertsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('AlertsPage entrega no Google Chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marca como "Não notificado" o alerta que nunca foi entregue', () => {
    renderAlerts([{ ...baseAlert, sentToChat: false, sentAt: null }]);

    expect(screen.getByText('Não notificado')).toBeInTheDocument();
    expect(screen.queryByText('Notificado')).not.toBeInTheDocument();
  });

  it('não marca o alerta entregue e mostra a data de entrega', () => {
    renderAlerts([{ ...baseAlert, id: 2, sentToChat: true, sentAt: '2026-08-20T12:05:00.000Z' }]);

    expect(screen.queryByText('Não notificado')).not.toBeInTheDocument();
    expect(screen.getByText(/Notificado em/)).toBeInTheDocument();
  });
});
