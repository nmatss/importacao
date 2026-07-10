import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/shared/hooks/useApi', () => ({
  useApiQuery: vi.fn(),
}));

import { useApiQuery } from '@/shared/hooks/useApi';
import { ProcessTimelineEvents } from './ProcessTimelineEvents';

describe('ProcessTimelineEvents', () => {
  it('shows a retryable error instead of an empty timeline when the request fails', () => {
    const refetch = vi.fn();
    vi.mocked(useApiQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('network unavailable'),
      refetch,
    } as unknown as ReturnType<typeof useApiQuery>);

    render(<ProcessTimelineEvents processId="123" />);

    expect(screen.getByText('Erro ao carregar o histórico de eventos.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /tentar novamente/i }));
    expect(refetch).toHaveBeenCalledOnce();
  });
});
