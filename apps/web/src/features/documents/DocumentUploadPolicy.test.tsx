import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/shared/hooks/useApi', () => ({ useApiQuery: vi.fn() }));

import { useApiQuery } from '@/shared/hooks/useApi';
import { DocumentUpload } from './DocumentUpload';

function renderUpload() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DocumentUpload processId="1" />
    </QueryClientProvider>,
  );
}

describe('DocumentUpload source policy', () => {
  it('replaces manual upload with Drive instructions in Drive-only mode', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: { source: 'drive', driveOnly: true, manualUploadEnabled: false },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useApiQuery>);

    renderUpload();

    expect(screen.getByText(/somente pela pasta do processo no Drive/i)).toBeInTheDocument();
    expect(screen.queryByText(/Arraste ou clique para enviar/i)).not.toBeInTheDocument();
  });

  it('fails closed in the UI when the policy cannot be confirmed', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as unknown as ReturnType<typeof useApiQuery>);

    renderUpload();

    expect(screen.getByRole('alert')).toHaveTextContent(/upload manual permanece bloqueado/i);
  });
});
