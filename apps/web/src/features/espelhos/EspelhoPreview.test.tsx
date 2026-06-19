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
  items: [] as unknown[],
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
        blob: vi.fn().mockResolvedValue(new Blob(['xlsx'])),
      }),
    );
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn().mockReturnValue('blob:espelho'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
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

  it('downloads XLSX using the espelho id instead of the process id', async () => {
    mockEspelho({ id: 987 });
    renderPreview();

    fireEvent.click(screen.getByRole('button', { name: /Baixar XLSX/i }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/espelhos/987/download',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
        }),
      ),
    );
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

  it('adds items using the backend espelho field contract', async () => {
    renderPreview();

    fireEvent.click(screen.getByRole('button', { name: /Adicionar item/i }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith('/api/espelhos/123/items', expect.any(Object)),
    );
    const [, options] = vi
      .mocked(fetch)
      .mock.calls.find(([url]) => url === '/api/espelhos/123/items')!;
    expect(options).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String(options?.body))).toMatchObject({
      ncmCode: '',
      boxQuantity: 0,
    });
  });

  it('edits the NCM cell using ncmCode instead of the display alias', async () => {
    mockEspelho({
      items: [
        {
          id: 55,
          itemCode: 'SKU-1',
          description: 'Produto',
          color: 'Azul',
          size: 'M',
          ncm: '6404.19.00',
          unitPrice: 10,
          quantity: 2,
          totalPrice: 20,
          boxes: 1,
          netWeight: 1,
          grossWeight: 1.5,
          isFoc: false,
          requiresLi: false,
          requiresCert: false,
        },
      ],
    });
    renderPreview();

    fireEvent.doubleClick(screen.getByText('6404.19.00'));
    const input = screen.getByDisplayValue('6404.19.00');
    fireEvent.change(input, { target: { value: '6404.20.00' } });
    fireEvent.blur(input);

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/espelhos/123/items/55',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ ncmCode: '6404.20.00' }),
        }),
      ),
    );
  });
});
