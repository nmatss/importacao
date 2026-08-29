import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@/shared/contexts/ThemeContext';

vi.mock('@/shared/lib/cert-api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/lib/cert-api-client')>();
  return {
    ...actual,
    fetchCertStats: vi.fn(),
    fetchCertReports: vi.fn(),
    fetchCertProducts: vi.fn(),
    fetchCertExpired: vi.fn(),
    checkCertApiHealth: vi.fn(),
  };
});

import {
  checkCertApiHealth,
  fetchCertExpired,
  fetchCertProducts,
  fetchCertReports,
  fetchCertStats,
} from '@/shared/lib/cert-api-client';
import CertDashboardPage from './CertDashboardPage';

const mockedStats = vi.mocked(fetchCertStats);
const mockedReports = vi.mocked(fetchCertReports);
const mockedProducts = vi.mocked(fetchCertProducts);
const mockedExpired = vi.mocked(fetchCertExpired);
const mockedHealth = vi.mocked(checkCertApiHealth);

function renderPage() {
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <CertDashboardPage />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

/**
 * Valor exibido no CARTÃO cujo rótulo é `label`. Escopado ao cartão porque os
 * mesmos rótulos aparecem também na legenda do gráfico de pizza.
 */
function cardValue(label: string): string {
  const card = screen
    .getAllByText(label)
    .map((node) => node.closest('div.min-w-0'))
    .find((el): el is HTMLElement => el !== null);
  if (!card) throw new Error(`Cartão "${label}" não encontrado`);
  return card.querySelector('p')?.textContent ?? '';
}

describe('CertDashboardPage', () => {
  beforeEach(() => {
    mockedStats.mockReset();
    mockedReports.mockReset();
    mockedProducts.mockReset();
    mockedExpired.mockReset();
    mockedHealth.mockReset();

    mockedReports.mockResolvedValue([]);
    mockedProducts.mockResolvedValue({ products: [] });
    mockedExpired.mockResolvedValue({ products: [] });
    mockedHealth.mockResolvedValue({ connected: true, latencyMs: 12 });
  });

  // ── Item 1 ──────────────────────────────────────────────────────────────
  it('exibe o bucket never_validated e fecha a soma com total_products', async () => {
    mockedStats.mockResolvedValue({
      total_products: 100,
      total_expired: 0,
      last_run: null,
      by_brand: [
        {
          brand: 'Imaginarium',
          ok: 40,
          inconsistent: 5,
          not_found: 5,
          never_validated: 10,
          expired: 0,
        },
        { brand: 'Puket', ok: 20, inconsistent: 3, not_found: 2, never_validated: 15, expired: 0 },
      ],
    });

    renderPage();

    expect((await screen.findAllByText('Não validado')).length).toBeGreaterThan(0);
    // 25 nunca-validados; a soma dos quatro buckets bate com total_products.
    expect(cardValue('Não validado')).toBe('25');
    expect(cardValue('Total Produtos')).toBe('100');
    expect(cardValue('Conforme')).toBe('60');
    expect(cardValue('Não Encontrado')).toBe('7');

    const total =
      Number(cardValue('Conforme')) +
      Number(cardValue('Inconsistente')) +
      Number(cardValue('Não Encontrado')) +
      Number(cardValue('Não validado'));
    expect(total).toBe(Number(cardValue('Total Produtos')));
  });

  it('não conta os nunca-validados no denominador da taxa de conformidade', async () => {
    mockedStats.mockResolvedValue({
      total_products: 100,
      by_brand: [
        { brand: 'Puket', ok: 50, inconsistent: 0, not_found: 0, never_validated: 50, expired: 0 },
      ],
    });

    renderPage();

    // 50 conformes sobre os 50 JÁ validados = 100%, não 50%.
    expect((await screen.findAllByText('100.0%')).length).toBeGreaterThan(0);
    expect(screen.queryByText('50.0%')).not.toBeInTheDocument();
  });

  // ── Item 3 ──────────────────────────────────────────────────────────────
  it('mostra erro em vez de "0" e "todos conformes" quando /api/stats falha', async () => {
    mockedStats.mockRejectedValue(new Error('Erro na API: 500'));

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(/Não foi possível carregar/i);
    expect(screen.getAllByRole('button', { name: /Tentar novamente/i }).length).toBeGreaterThan(0);

    // Nenhum cartão pode dizer "0" — é ausência de dado, não zero.
    expect(cardValue('Total Produtos')).toBe('—');
    expect(cardValue('Conforme')).toBe('—');
    expect(cardValue('Não Encontrado')).toBe('—');
  });

  it('sai do skeleton mesmo quando todas as chamadas falham', async () => {
    mockedStats.mockRejectedValue(new Error('boom'));
    mockedReports.mockRejectedValue(new Error('boom'));
    mockedProducts.mockRejectedValue(new Error('boom'));
    mockedExpired.mockRejectedValue(new Error('boom'));
    mockedHealth.mockRejectedValue(new Error('boom'));

    renderPage();

    // Antes o `.then` explodia, `setLoading(false)` nunca rodava e o skeleton
    // ficava eterno.
    expect(await screen.findByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Sistema Offline')).toBeInTheDocument();
  });

  it('distingue lista de problemas vazia de lista indisponível', async () => {
    mockedStats.mockResolvedValue({ total_products: 10, by_brand: [] });
    mockedProducts.mockRejectedValue(new Error('Erro na API: 500'));

    renderPage();

    await waitFor(() => expect(screen.getByText('Produtos com Problemas')).toBeInTheDocument());
    expect(screen.queryByText('Todos os produtos estão em conformidade')).not.toBeInTheDocument();
    expect(screen.getAllByText('Não foi possível carregar').length).toBeGreaterThan(0);
  });

  it('diz "nenhum problema" quando a chamada tem sucesso e volta vazia', async () => {
    mockedStats.mockResolvedValue({ total_products: 10, by_brand: [] });

    renderPage();

    expect(await screen.findByText('Nenhum problema encontrado')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
