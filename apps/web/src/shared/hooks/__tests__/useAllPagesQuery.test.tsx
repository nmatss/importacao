import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/shared/lib/api-client', () => ({ api }));

const { useAllPagesQuery } = await import('../useApi');

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Uma resposta no formato que `sendPaginated` devolve. */
function pagina(itens: number[], total: number, pages: number) {
  return { data: itens.map((id) => ({ id })), pagination: { total, pages } };
}

/**
 * Este hook existe por causa de quatro telas que pediam UMA pagina e tratavam a
 * fatia como o conjunto inteiro. O caso mais grave era o seletor de processo do
 * cambio: consultava `/api/processes` sem `limit`, o default do backend e 20, e
 * nenhum processo fora dos 20 mais recentes podia receber lancamento. Em
 * Desembaraco e Numerario a fatia era somada como se fosse o total, entao os
 * cartoes mostravam numero errado.
 */
describe('useAllPagesQuery', () => {
  beforeEach(() => vi.clearAllMocks());

  it('percorre TODAS as paginas e concatena', async () => {
    api.get.mockResolvedValueOnce(pagina([1, 2], 3, 2)).mockResolvedValueOnce(pagina([3], 3, 2));

    const { result } = renderHook(() => useAllPagesQuery<{ id: number }>(['p'], '/api/processes'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data.map((p) => p.id)).toEqual([1, 2, 3]);
    expect(result.current.data?.truncated).toBe(false);
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('pede limite explicito: sem ele o backend devolve so 20', async () => {
    api.get.mockResolvedValueOnce(pagina([1], 1, 1));

    const { result } = renderHook(() => useAllPagesQuery<{ id: number }>(['p'], '/api/processes'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get.mock.calls[0][0]).toBe('/api/processes?page=1&limit=100');
  });

  it('preserva a query string que a tela ja montou', async () => {
    api.get.mockResolvedValueOnce(pagina([1], 1, 1));

    const { result } = renderHook(
      () => useAllPagesQuery<{ id: number }>(['f'], '/api/follow-up?startDate=2026-08-01'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get.mock.calls[0][0]).toBe('/api/follow-up?startDate=2026-08-01&page=1&limit=100');
  });

  it('para quando a pagina volta vazia, mesmo se `pages` mentir', async () => {
    api.get.mockResolvedValueOnce(pagina([1], 999, 99)).mockResolvedValueOnce(pagina([], 999, 99));

    const { result } = renderHook(() => useAllPagesQuery<{ id: number }>(['p'], '/api/x'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledTimes(2);
    // E avisa que o conjunto veio incompleto, em vez de fingir que 1 = 999.
    expect(result.current.data?.truncated).toBe(true);
  });

  it('respeita o teto de paginas e sinaliza truncamento', async () => {
    api.get.mockResolvedValue(pagina([1], 100_000, 9_999));

    const { result } = renderHook(() => useAllPagesQuery<{ id: number }>(['p'], '/api/x'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledTimes(20);
    expect(result.current.data?.truncated).toBe(true);
  });
});
