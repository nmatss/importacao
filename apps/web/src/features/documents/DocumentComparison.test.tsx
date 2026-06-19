import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/shared/lib/api-client', () => ({
  api: { post: vi.fn() },
}));

const mockRefetch = vi.fn();

vi.mock('@/shared/hooks/useApi', () => ({
  useApiQuery: vi.fn(),
}));

import { useApiQuery } from '@/shared/hooks/useApi';
import { DocumentComparison } from './DocumentComparison';

function renderComparison() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DocumentComparison processId="1" />
    </QueryClientProvider>,
  );
}

describe('DocumentComparison', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows an error state instead of the empty state when comparison loading fails', () => {
    vi.mocked(useApiQuery).mockImplementation((queryKey: readonly unknown[]) => {
      const key = Array.isArray(queryKey) ? queryKey[0] : null;
      return {
        data: key === 'process-events' ? [] : undefined,
        isLoading: false,
        isError: key === 'doc-comparison',
        error: key === 'doc-comparison' ? new Error('boom') : null,
        refetch: mockRefetch,
      } as unknown as ReturnType<typeof useApiQuery>;
    });

    renderComparison();

    expect(screen.getByRole('alert')).toHaveTextContent(/Erro ao carregar comparativo documental/i);
    expect(screen.queryByText(/Nenhum dado disponivel/i)).not.toBeInTheDocument();
  });
});
