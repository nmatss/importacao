import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockRefetch = vi.fn();

vi.mock('@/shared/hooks/useApi', () => ({
  useApiQuery: vi.fn(),
}));

import { useApiQuery } from '@/shared/hooks/useApi';
import { ProformasTab } from './ProformasTab';

describe('ProformasTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows an error state instead of the empty state when the aggregate query fails', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('boom'),
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useApiQuery>);

    render(<ProformasTab processId="1" />);

    expect(screen.getByRole('alert')).toHaveTextContent(/Erro ao carregar proformas/i);
    expect(screen.queryByText(/Nenhuma Proforma Invoice anexada/i)).not.toBeInTheDocument();
  });
});
