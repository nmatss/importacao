import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/shared/lib/cert-api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/lib/cert-api-client')>();
  return {
    ...actual,
    fetchCertProductDetail: vi.fn(),
    fetchLastCertSync: vi.fn().mockResolvedValue({ last_run: null }),
    lookupCertificateLinx: vi.fn(),
    verifyCertProduct: vi.fn(),
  };
});

import {
  fetchCertProductDetail,
  fetchLastCertSync,
  lookupCertificateLinx,
  type CertProduct,
} from '@/shared/lib/cert-api-client';
import CertProdutoDetailPage, { divergeDoLinx } from './CertProdutoDetailPage';

const mockedProduct = vi.mocked(fetchCertProductDetail);
const mockedLookup = vi.mocked(lookupCertificateLinx);

describe('CertProdutoDetailPage certificate sources', () => {
  beforeEach(() => {
    mockedProduct.mockReset();
    mockedLookup.mockReset();
    mockedProduct.mockResolvedValue({
      sku: 'PI7223Y',
      name: 'Produto Imaginarium',
      brand: 'Imaginarium',
      numero_certificado: 'CERT-2026-001',
      certification_type: 'INMETRO',
      cert_status: 'ATIVO',
      site_status: 'CONFORME',
      license_status: 'VALIDO',
    });
    mockedLookup.mockResolvedValue({
      status: 'found',
      sku: 'PI7223Y',
      brand: 'imaginarium',
      produto_codigo: 'PI7223Y',
      validade_certificado: '2027-07-24',
      vencimento_licenciamento: '2027-12-31',
      properties: {
        validade_certificado: {
          property_code: '00106',
          raw_value: '24/07/2027',
          state: 'found',
        },
        vencimento_licenciamento: {
          property_code: '00107',
          raw_value: '31/12/2027',
          state: 'found',
        },
      },
    });
  });

  it('identifica snapshot anterior quando a última sincronização falhou', async () => {
    vi.mocked(fetchLastCertSync).mockResolvedValueOnce({
      last_run: {
        id: 'sync-1',
        trigger: 'manual',
        actor: null,
        started_at: '2026-09-12T12:00:00Z',
        finished_at: '2026-09-12T12:01:00Z',
        result: null,
        error: 'Linx indisponível',
      },
    });
    render(
      <MemoryRouter initialEntries={['/certificacoes/produtos/PI7223Y']}>
        <Routes>
          <Route path="/certificacoes/produtos/:sku" element={<CertProdutoDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Linx indisponível');
    expect(screen.getByRole('status')).toHaveTextContent('últimos salvos');
    expect(await screen.findByText('CERT-2026-001')).toBeInTheDocument();
  });

  it('shows spreadsheet metadata and live Imaginarium Linx properties', async () => {
    render(
      <MemoryRouter initialEntries={['/certificacoes/produtos/PI7223Y']}>
        <Routes>
          <Route path="/certificacoes/produtos/:sku" element={<CertProdutoDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(mockedLookup).toHaveBeenCalledWith('imaginarium', 'PI7223Y'));
    expect(await screen.findByText('CERT-2026-001')).toBeInTheDocument();
    expect(await screen.findByText(/prop 00106/i)).toBeInTheDocument();
    expect(screen.getByText(/prop 00107/i)).toBeInTheDocument();
    expect(screen.getByText('24/07/2027')).toBeInTheDocument();
    expect(screen.queryByText(/^Linha$/)).not.toBeInTheDocument();
  });

  it('preserves a percent sign in the SKU decoded by the router', async () => {
    render(
      <MemoryRouter initialEntries={['/certificacoes/produtos/SKU%2525']}>
        <Routes>
          <Route path="/certificacoes/produtos/:sku" element={<CertProdutoDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(mockedProduct).toHaveBeenCalledWith('SKU%25'));
  });
});

describe('divergeDoLinx', () => {
  it('devolve null enquanto o Linx nao foi sincronizado', () => {
    // "Nao verificado" nunca pode ser apresentado como "nao diverge".
    expect(divergeDoLinx('2026-10-29', null, null)).toBeNull();
    expect(divergeDoLinx(null, null, undefined)).toBeNull();
  });

  it('compara trava calculada com o FIM_VENDAS do ERP', () => {
    const sync = '2026-09-11T12:00:00+00:00';
    expect(divergeDoLinx('2026-10-29', '2026-10-29', sync)).toBe(false);
    expect(divergeDoLinx('2026-10-29', '2027-03-22', sync)).toBe(true);
    // Certificado ativo (sem trava) com data gravada no ERP: divergencia.
    expect(divergeDoLinx(null, '2027-03-22', sync)).toBe(true);
    expect(divergeDoLinx(null, null, sync)).toBe(false);
  });
});

describe('CertProdutoDetailPage — trava de venda (D11)', () => {
  function renderDetail() {
    return render(
      <MemoryRouter initialEntries={['/certificacoes/produtos/PI5558Y']}>
        <Routes>
          <Route path="/certificacoes/produtos/:sku" element={<CertProdutoDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  function product(overrides: Partial<CertProduct> = {}): CertProduct {
    return {
      sku: 'PI5558Y',
      name: 'Karaoke Portatil 2 Mic',
      brand: 'Imaginarium',
      cert_status: 'ATIVO',
      ...overrides,
    };
  }

  beforeEach(() => {
    mockedProduct.mockReset();
    mockedLookup.mockReset();
    mockedLookup.mockRejectedValue(new Error('Linx indisponivel'));
  });

  it('mostra as datas dos dois eixos e o status de venda em portugues', async () => {
    mockedProduct.mockResolvedValue(
      product({
        validade_certificado: '2028-07-27',
        sale_deadline: '29/10/2026',
        linx_fim_licenciamento: '2027-01-31',
        trava_venda: '2026-10-29',
        trava_origem: 'certificacao',
        status_venda: 'BLOQUEADA',
        linx_fim_vendas: '2026-07-27',
        linx_synced_at: '2026-09-11T12:00:00+00:00',
      }),
    );
    renderDetail();

    expect(await screen.findByText('Trava de venda')).toBeInTheDocument();
    expect(screen.getByText('27/07/2028')).toBeInTheDocument();
    // `sale_deadline` também aparece no resumo do topo da página.
    expect(screen.getAllByText('29/10/2026').length).toBeGreaterThan(0);
    expect(screen.getByText('31/01/2027')).toBeInTheDocument();
    expect(screen.getByText('Bloqueada')).toBeInTheDocument();
    expect(screen.getByText('Fim de venda da certificação')).toBeInTheDocument();
    // Nunca a chave tecnica do enum.
    expect(screen.queryByText('BLOQUEADA')).not.toBeInTheDocument();
    expect(screen.queryByText('certificacao')).not.toBeInTheDocument();
  });

  it('acusa a divergencia entre a trava calculada e o ERP', async () => {
    mockedProduct.mockResolvedValue(
      product({
        trava_venda: '2026-10-29',
        linx_fim_vendas: '2026-07-27',
        linx_synced_at: '2026-09-11T12:00:00+00:00',
      }),
    );
    renderDetail();

    expect(await screen.findByText(/Diverge do Linx/)).toBeInTheDocument();
  });

  it('diz que nao da para comparar quando o Linx nunca foi sincronizado', async () => {
    mockedProduct.mockResolvedValue(product({ trava_venda: '2026-10-29' }));
    renderDetail();

    expect(await screen.findByText(/Linx ainda não sincronizado/)).toBeInTheDocument();
    expect(screen.queryByText(/Diverge do Linx/)).not.toBeInTheDocument();
  });

  it('nao inventa data quando o produto nao tem trava', async () => {
    mockedProduct.mockResolvedValue(product({ linx_synced_at: '2026-09-11T12:00:00+00:00' }));
    renderDetail();

    await screen.findByText('Trava de venda');
    // Validade, licenciamento, trava e FIM_VENDAS ausentes -> quatro '-'.
    expect(screen.getAllByText('-').length).toBeGreaterThanOrEqual(4);
  });
});
