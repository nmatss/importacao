import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/shared/hooks/useApi', () => ({
  useApiQuery: vi.fn(),
}));

import { toast } from 'sonner';
import { useApiQuery } from '@/shared/hooks/useApi';
import { EspelhoPreview } from './EspelhoPreview';

const baseEspelho = {
  id: 1,
  status: 'draft',
  items: [],
  totalFobValue: 0,
  totalQuantity: 0,
  totalNetWeight: 0,
  totalGrossWeight: 0,
  totalBoxes: 0,
  driveFileId: null,
  driveSentAt: null,
  sentToFenicia: false,
  sentToFeniciaAt: null,
};

function mockEspelho(overrides: Partial<typeof baseEspelho> = {}) {
  vi.mocked(useApiQuery).mockReturnValue({
    data: { ...baseEspelho, ...overrides },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useApiQuery>);
}

function renderPreview() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

  render(
    <QueryClientProvider client={queryClient}>
      <EspelhoPreview processId="123" />
    </QueryClientProvider>,
  );

  return { invalidateSpy };
}

describe('EspelhoPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('importacao_token', 'token-123');
    mockEspelho();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({}),
      }),
    );
  });

  it('requires confirmation before sending the espelho to Fenicia', async () => {
    renderPreview();

    fireEvent.click(screen.getByRole('button', { name: /Enviar para Fenícia/i }));

    expect(
      screen.getByRole('dialog', { name: /Enviar espelho para Fenícia/i }),
    ).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends to Fenicia after confirmation and refreshes related state', async () => {
    const { invalidateSpy } = renderPreview();

    fireEvent.click(screen.getByRole('button', { name: /Enviar para Fenícia/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Enviar$/i }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/espelhos/123/send-fenicia',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
        }),
      ),
    );
    expect(toast.success).toHaveBeenCalledWith('Espelho enviado para Fenícia com sucesso.');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['espelho', '123'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['process', '123'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['process-events', '123'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['communications', '123'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['communications'] });
  });

  it('disables Fenicia send action when the espelho was already sent', () => {
    mockEspelho({ sentToFenicia: true });
    renderPreview();

    expect(screen.getByRole('button', { name: /Enviado à Fenícia/i })).toBeDisabled();
  });

  it('does not crash and shows an empty state when items are undefined', () => {
    // Simulate an espelho payload missing the items array entirely.
    vi.mocked(useApiQuery).mockReturnValue({
      data: { ...baseEspelho, items: undefined },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useApiQuery>);

    expect(() => renderPreview()).not.toThrow();
    expect(screen.getByText(/Nenhum item no espelho ainda/i)).toBeInTheDocument();
  });
});
