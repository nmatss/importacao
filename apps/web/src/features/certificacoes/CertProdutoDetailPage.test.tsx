import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/shared/lib/cert-api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/lib/cert-api-client')>();
  return {
    ...actual,
    fetchCertProductDetail: vi.fn(),
    lookupCertificateLinx: vi.fn(),
    verifyCertProduct: vi.fn(),
  };
});

import { fetchCertProductDetail, lookupCertificateLinx } from '@/shared/lib/cert-api-client';
import CertProdutoDetailPage from './CertProdutoDetailPage';

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
