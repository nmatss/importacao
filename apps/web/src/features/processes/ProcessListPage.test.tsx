import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

vi.mock('@/shared/hooks/useApi', () => ({ useApiQuery: vi.fn() }));

import { useApiQuery } from '@/shared/hooks/useApi';
import { ProcessListPage } from './ProcessListPage';

/** URLs pedidas a API, em ordem — a ultima reflete o filtro vigente. */
const requestedUrls: string[] = [];

function mockList() {
  requestedUrls.length = 0;
  vi.mocked(useApiQuery).mockImplementation(((_key: readonly unknown[], url: string) => {
    requestedUrls.push(url);
    return {
      data: {
        data: [
          {
            id: 1,
            processCode: 'IMP-2026-001',
            brand: 'puket',
            status: 'validating',
            totalFobValue: 100,
            etd: '2026-03-15',
            createdAt: '2026-01-02T00:00:00.000Z',
          },
        ],
        pagination: { total: 1, page: 1, limit: 20, pages: 1 },
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    };
  }) as unknown as typeof useApiQuery);
}

let currentSearch = '';
function LocationProbe() {
  currentSearch = useLocation().search;
  return null;
}

function renderList(initialEntry = '/importacao/processos') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/importacao/processos"
          element={
            <>
              <ProcessListPage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const lastUrl = () => requestedUrls[requestedUrls.length - 1];

describe('ProcessListPage — filtros na URL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentSearch = '';
    mockList();
  });

  it('aplica o ?status= vindo dos cards do Meu Dia', () => {
    // O link "Divergencias a resolver" leva para ?status=validating; antes o
    // parametro era ignorado e o usuario caia na lista completa.
    renderList('/importacao/processos?status=validating');

    expect(lastUrl()).toContain('status=validating');
    expect(screen.getByLabelText('Filtrar processos por status')).toHaveValue('validating');
  });

  it('aplica os demais filtros e a pagina vindos da URL (sobrevive a refresh)', () => {
    renderList('/importacao/processos?brand=puket&search=IMP&page=3');

    const url = lastUrl();
    expect(url).toContain('brand=puket');
    expect(url).toContain('search=IMP');
    expect(url).toContain('page=3');
    expect(screen.getByLabelText('Buscar processo')).toHaveValue('IMP');
  });

  it('escreve o filtro de marca na URL', async () => {
    const user = userEvent.setup();
    renderList();

    await user.selectOptions(screen.getByLabelText('Filtrar processos por marca'), 'puket');

    await waitFor(() => expect(currentSearch).toContain('brand=puket'));
    expect(lastUrl()).toContain('brand=puket');
  });

  it('leva a busca para a URL depois do debounce de 300ms', async () => {
    const user = userEvent.setup();
    renderList();

    await user.type(screen.getByLabelText('Buscar processo'), 'IMP-2026');

    // Antes do debounce a URL ainda nao mudou.
    expect(currentSearch).not.toContain('search=');

    await waitFor(() => expect(currentSearch).toContain('search=IMP-2026'), { timeout: 2000 });
    expect(lastUrl()).toContain('search=IMP-2026');
  });

  it('volta para a pagina 1 ao trocar um filtro', async () => {
    const user = userEvent.setup();
    renderList('/importacao/processos?page=4');
    expect(lastUrl()).toContain('page=4');

    await user.selectOptions(screen.getByLabelText('Filtrar processos por status'), 'validating');

    await waitFor(() => expect(lastUrl()).toContain('page=1'));
    expect(currentSearch).not.toContain('page=4');
  });

  it('"Limpar filtros" zera a URL e o campo de busca', async () => {
    const user = userEvent.setup();
    renderList('/importacao/processos?status=validating&brand=puket&search=IMP');

    await user.click(screen.getByRole('button', { name: /Limpar filtros/i }));

    await waitFor(() => expect(currentSearch).toBe(''));
    expect(screen.getByLabelText('Buscar processo')).toHaveValue('');
  });
});
