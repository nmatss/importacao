import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { MockAuthProvider, mockUser } from '@/test/mocks/auth';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/shared/lib/cert-api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/lib/cert-api-client')>();
  return {
    ...actual,
    fetchCertReports: vi.fn(),
    downloadCertApiResource: vi.fn(),
    downloadCertReport: vi.fn(),
    certApiFetch: vi.fn(),
  };
});

import { toast } from 'sonner';
import {
  certApiFetch,
  downloadCertApiResource,
  fetchCertReports,
} from '@/shared/lib/cert-api-client';
import CertRelatoriosPage from './CertRelatoriosPage';

function renderPage(role: 'admin' | 'analyst' = 'admin') {
  return render(
    <MemoryRouter>
      <MockAuthProvider value={{ user: { ...mockUser, role } }}>
        <CertRelatoriosPage />
      </MockAuthProvider>
    </MemoryRouter>,
  );
}

describe('CertRelatoriosPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchCertReports).mockResolvedValue([]);
    vi.mocked(downloadCertApiResource).mockResolvedValue(undefined);
    vi.mocked(certApiFetch).mockResolvedValue({
      json: vi.fn().mockResolvedValue({ wms: 1, ecommerce_puket: 2, ecommerce_imaginarium: 3 }),
    } as unknown as Response);
  });

  it('does not offer JSON-only actions for generated XLSX reports', async () => {
    vi.mocked(fetchCertReports).mockResolvedValue([
      { filename: 'validation_001.json', format: 'json' },
      { filename: 'estoque_detalhado_001.xlsx', format: 'xlsx' },
    ]);

    renderPage();

    await screen.findByText('validation_001');
    expect(screen.getByText('estoque_detalhado_001')).toBeInTheDocument();
    expect(screen.getAllByText('Excel')).toHaveLength(2);
    expect(screen.getAllByText('Ver')).toHaveLength(1);
    expect(screen.getAllByText('JSON')).toHaveLength(1);
  });

  it('uses POST download helper for stock export and preserves selected brand', async () => {
    renderPage();

    await waitFor(() => expect(fetchCertReports).toHaveBeenCalled());
    await userEvent.selectOptions(screen.getByLabelText(/Filtrar marca/i), 'puket_escolares');
    await userEvent.click(screen.getByText(/Estoque Detalhado/i));

    expect(downloadCertApiResource).toHaveBeenCalledWith(
      '/api/reports/export-stock?brand=puket_escolares',
      expect.stringMatching(/^relatorio_stock_/),
      { method: 'POST' },
    );
  });

  it('shows detailed load errors instead of a generic message', async () => {
    vi.mocked(fetchCertReports).mockRejectedValue(new Error('Erro na API: 403 Forbidden'));

    renderPage();

    expect(await screen.findByText(/403 Forbidden/)).toBeInTheDocument();
  });

  it('sanitizes partial sync details in the toast', async () => {
    vi.mocked(certApiFetch).mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        wms: 0,
        ecommerce_puket: 2,
        ecommerce_imaginarium: 3,
        errors: ['WMS Oracle: host interno sensivel'],
      }),
    } as unknown as Response);

    renderPage();

    await waitFor(() => expect(fetchCertReports).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: /Sync Estoque/i }));

    expect(toast.warning).toHaveBeenCalledWith(
      'Sync parcial: 1 fonte(s) falharam. Verifique logs da cert-api.',
    );
    expect(toast.warning).not.toHaveBeenCalledWith(expect.stringContaining('host interno'));
  });

  it('does not expose stock synchronization to analyst users', async () => {
    renderPage('analyst');

    await waitFor(() => expect(fetchCertReports).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Sync Estoque/i })).not.toBeInTheDocument();
  });
});
