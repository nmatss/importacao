import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { formatDateTime } from '@/shared/lib/utils';
import { matchesStatusFilters } from './CertProdutosPage';
import type { CertProduct, CertProductsResponse } from '@/shared/lib/cert-api-client';

vi.mock('@/shared/lib/cert-api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/lib/cert-api-client')>();
  return {
    ...actual,
    fetchCertProducts: vi.fn(),
    verifyCertProduct: vi.fn(),
  };
});

import { fetchCertProducts } from '@/shared/lib/cert-api-client';
import CertProdutosPage from './CertProdutosPage';

type Semantic = Pick<CertProduct, 'cert_status' | 'site_status' | 'license_status'>;

const product: Semantic = {
  cert_status: 'ATIVO',
  site_status: 'CONFORME',
  license_status: 'VALIDO',
};

describe('matchesStatusFilters', () => {
  it('matches when all filters are empty ("Todos")', () => {
    expect(
      matchesStatusFilters(product, { cert_status: '', site_status: '', license_status: '' }),
    ).toBe(true);
  });

  it('filters on cert_status', () => {
    expect(
      matchesStatusFilters(product, {
        cert_status: 'ATIVO',
        site_status: '',
        license_status: '',
      }),
    ).toBe(true);
    expect(
      matchesStatusFilters(product, {
        cert_status: 'ENCERRADO',
        site_status: '',
        license_status: '',
      }),
    ).toBe(false);
  });

  it('filters on site_status', () => {
    expect(
      matchesStatusFilters(product, {
        cert_status: '',
        site_status: 'NAO_CONFORME',
        license_status: '',
      }),
    ).toBe(false);
  });

  it('filters on license_status', () => {
    expect(
      matchesStatusFilters(product, {
        cert_status: '',
        site_status: '',
        license_status: 'VALIDO',
      }),
    ).toBe(true);
    expect(
      matchesStatusFilters(product, {
        cert_status: '',
        site_status: '',
        license_status: 'VENCIDO',
      }),
    ).toBe(false);
  });

  it('requires every active axis to match (AND semantics)', () => {
    expect(
      matchesStatusFilters(product, {
        cert_status: 'ATIVO',
        site_status: 'CONFORME',
        license_status: 'VENCIDO',
      }),
    ).toBe(false);
  });

  it('does not match a null axis against an active filter', () => {
    const partial: Semantic = { cert_status: null, site_status: 'CONFORME', license_status: null };
    expect(
      matchesStatusFilters(partial, {
        cert_status: 'ATIVO',
        site_status: '',
        license_status: '',
      }),
    ).toBe(false);
  });
});

const mockedFetch = vi.mocked(fetchCertProducts);

function renderPage() {
  return render(
    <MemoryRouter>
      <CertProdutosPage />
    </MemoryRouter>,
  );
}

describe('CertProdutosPage (server-authoritative)', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
  });

  it('uses the server total for the "N produtos encontrados" count, not the page length', async () => {
    // Server returns a single page of 2 products but reports a much larger total.
    const response: CertProductsResponse = {
      products: [
        { sku: 'A1', brand: 'Puket', name: 'Prod A', site_status: 'CONFORME' },
        { sku: 'A2', brand: 'Puket', name: 'Prod B', site_status: 'CONFORME' },
      ],
      total: 137,
      total_pages: 6,
      page: 1,
      per_page: 25,
    };
    mockedFetch.mockResolvedValue(response);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('137')).toBeInTheDocument();
    });
    expect(screen.getByText(/produtos? encontrados?/i)).toBeInTheDocument();
  });

  it('renders site_status_reason under the badge when site_status is NAO_CONFORME', async () => {
    const reason = 'Verificacao pendente - revisar';
    const response: CertProductsResponse = {
      products: [
        {
          sku: 'B1',
          brand: 'Puket',
          name: 'Nao conforme',
          site_status: 'NAO_CONFORME',
          site_status_reason: reason,
        },
        {
          sku: 'B2',
          brand: 'Puket',
          name: 'Conforme',
          site_status: 'CONFORME',
          site_status_reason: 'nao deve aparecer',
        },
      ],
      total: 2,
      total_pages: 1,
    };
    mockedFetch.mockResolvedValue(response);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(reason)).toBeInTheDocument();
    });
    // The reason for a CONFORME product must not be rendered.
    expect(screen.queryByText('nao deve aparecer')).not.toBeInTheDocument();
  });

  it('shows "--" for Licen. - Prazo when license_deadline is absent', async () => {
    const response: CertProductsResponse = {
      products: [{ sku: 'C1', brand: 'Puket', name: 'Sem prazo', site_status: 'CONFORME' }],
      total: 1,
      total_pages: 1,
    };
    mockedFetch.mockResolvedValue(response);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Sem prazo')).toBeInTheDocument();
    });
    // No license_deadline emitted -> graceful "--" placeholder present.
    expect(screen.getAllByText('--').length).toBeGreaterThan(0);
  });

  it('keeps WMS physical stock visible when all units are reserved', async () => {
    mockedFetch.mockResolvedValue({
      products: [
        {
          sku: 'PI7223Y',
          brand: 'Imaginarium',
          name: 'Produto reservado',
          stock_cd: 0,
          stock_ecommerce: 28,
          stock_total: 28,
          stock_detail: [
            {
              source: 'wms_biguacu',
              warehouse: 'CD EXPEDIÇÃO',
              quantity: 7,
              available: 0,
            },
          ],
        },
      ],
      total: 1,
      total_pages: 1,
    });

    renderPage();

    expect(
      await screen.findByRole('button', {
        name: 'Mostrar estoque disponivel e fisico do CD para o SKU PI7223Y',
      }),
    ).toHaveTextContent('0');
    expect(screen.getByText('0 / 7')).toBeInTheDocument();
  });

  // ── Item 4: zero não é o mesmo que desconhecido ─────────────────────────
  it('mostra "—" (não "0") nas colunas de estoque quando o SKU nunca foi sincronizado', async () => {
    mockedFetch.mockResolvedValue({
      // Um SKU sem linha em cert_stock: o backend devolve 0 por AUSÊNCIA de dado.
      products: [
        {
          sku: 'SEM-SYNC',
          brand: 'Puket',
          name: 'Nunca sincronizado',
          stock_cd: 0,
          stock_ecommerce: 0,
          stock_total: 0,
        },
      ],
      total: 1,
      total_pages: 1,
    });

    renderPage();

    await screen.findByText('Nunca sincronizado');
    const row = screen.getByText('Nunca sincronizado').closest('tr') as HTMLElement;

    // CD, E-com e Total: três "—", nenhum "0" pintado de vermelho.
    const unknowns = within(row).getAllByTitle(/Sem sincronizacao de estoque/i);
    expect(unknowns).toHaveLength(3);
    for (const cell of unknowns) expect(cell).toHaveTextContent('—');
    expect(within(row).queryByText('0')).not.toBeInTheDocument();
  });

  it('mostra "0" de verdade e a data do sync quando o SKU foi sincronizado', async () => {
    mockedFetch.mockResolvedValue({
      products: [
        {
          sku: 'COM-SYNC',
          brand: 'Puket',
          name: 'Zerado de verdade',
          stock_cd: 0,
          stock_ecommerce: 0,
          stock_total: 0,
          stock_synced_at: '2026-08-28T12:30:00Z',
        },
      ],
      total: 1,
      total_pages: 1,
    });

    renderPage();

    await screen.findByText('Zerado de verdade');
    const row = screen.getByText('Zerado de verdade').closest('tr') as HTMLElement;

    expect(within(row).queryByTitle(/Sem sincronizacao de estoque/i)).not.toBeInTheDocument();
    expect(within(row).getAllByText('0').length).toBeGreaterThan(0);
    // A data de sync passa a ser visível na linha (antes só existia dentro do
    // tooltip do CD, que só aparecia com estoque > 0).
    expect(within(row).getByText(formatDateTime('2026-08-28T12:30:00Z'))).toBeInTheDocument();
  });

  // ── Item 5: tooltip do CD acessível por teclado/toque ───────────────────
  it('abre o tooltip de estoque do CD por clique, não só por hover', async () => {
    mockedFetch.mockResolvedValue({
      products: [
        {
          sku: 'PI7223Y',
          brand: 'Imaginarium',
          name: 'Com estoque',
          stock_cd: 7,
          stock_total: 7,
          stock_synced_at: '2026-08-28T12:30:00Z',
          stock_detail: [
            { source: 'wms_biguacu', warehouse: 'CD EXPEDIÇÃO', quantity: 7, available: 7 },
          ],
        },
      ],
      total: 1,
      total_pages: 1,
    });

    renderPage();

    const trigger = await screen.findByRole('button', {
      name: 'Mostrar estoque disponivel e fisico do CD para o SKU PI7223Y',
    });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
