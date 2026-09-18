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
    fetchCertProducts: vi.fn(),
    downloadCertApiResource: vi.fn(),
    downloadCertReport: vi.fn(),
    certApiFetch: vi.fn(),
  };
});

import { toast } from 'sonner';
import {
  certApiFetch,
  downloadCertApiResource,
  fetchCertProducts,
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
    vi.mocked(fetchCertProducts).mockResolvedValue({ products: [], total: 12 });
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

  it('mostra "0 B" para arquivo vazio em vez de vazar um "0" solto na linha', async () => {
    vi.mocked(fetchCertReports).mockResolvedValue([
      { filename: 'validation_vazio.json', format: 'json', size_bytes: 0 },
      { filename: 'validation_cheio.json', format: 'json', size_bytes: 2048 },
      { filename: 'sem_tamanho.json', format: 'json' },
    ]);

    renderPage();

    await screen.findByText('validation_vazio');
    expect(screen.getByText('0 B')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    // `{0 && <jsx/>}` renderiza o numero 0 como texto.
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    // Sem o campo, nao inventa tamanho.
    const semTamanho = screen.getByText('sem_tamanho').parentElement as HTMLElement;
    expect(semTamanho).not.toHaveTextContent(/\bB\b|KB|MB/);
  });

  describe('exportacao sem produtos', () => {
    it('avisa que o filtro nao tem produtos em vez de dizer so "exportado"', async () => {
      vi.mocked(fetchCertProducts).mockResolvedValue({ products: [], total: 0 });
      renderPage();
      await waitFor(() => expect(fetchCertReports).toHaveBeenCalled());

      await userEvent.selectOptions(screen.getByLabelText(/Filtrar marca/i), 'imaginarium');
      await userEvent.click(screen.getByText(/Vencidos \/ Em Encerramento/i));

      // A contagem usa exatamente os mesmos filtros da exportacao.
      await waitFor(() =>
        expect(fetchCertProducts).toHaveBeenCalledWith({
          brand: 'imaginarium',
          status: 'EXPIRED',
          per_page: 1,
        }),
      );
      // O download nao e bloqueado: o backend ja entrega o arquivo.
      expect(downloadCertApiResource).toHaveBeenCalledWith(
        '/api/reports/export?status=EXPIRED&brand=imaginarium',
        expect.stringMatching(/^relatorio_expired_/),
        { method: 'POST' },
      );
      await waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));
      expect(vi.mocked(toast.warning).mock.calls[0][0]).toMatch(/nenhum produto/i);
      expect(toast.success).not.toHaveBeenCalled();

      const aviso = await screen.findByRole('status');
      expect(aviso).toHaveTextContent(/Vencidos \/ Em Encerramento/);
      expect(aviso).toHaveTextContent(/Imaginarium/);
      expect(aviso).toHaveTextContent(/apenas o cabeçalho/i);
    });

    it('mantem o toast de sucesso e nao mostra aviso quando ha produtos', async () => {
      renderPage();
      await waitFor(() => expect(fetchCertReports).toHaveBeenCalled());

      await userEvent.click(screen.getByText('Todos os Produtos'));

      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith('Relatorio "Todos os Produtos" exportado'),
      );
      expect(fetchCertProducts).toHaveBeenCalledWith({ per_page: 1 });
      expect(toast.warning).not.toHaveBeenCalled();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('nao derruba a exportacao quando a contagem falha', async () => {
      vi.mocked(fetchCertProducts).mockRejectedValue(new Error('Erro na API: 500'));
      renderPage();
      await waitFor(() => expect(fetchCertReports).toHaveBeenCalled());

      await userEvent.click(screen.getByText('Todos os Produtos'));

      await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
      expect(toast.error).not.toHaveBeenCalled();
      expect(toast.warning).not.toHaveBeenCalled();
    });

    it('nao inventa contagem para o estoque detalhado, que nao sai de cert_products', async () => {
      vi.mocked(fetchCertProducts).mockResolvedValue({ products: [], total: 0 });
      renderPage();
      await waitFor(() => expect(fetchCertReports).toHaveBeenCalled());

      await userEvent.click(screen.getByText(/Estoque Detalhado/i));

      await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
      expect(fetchCertProducts).not.toHaveBeenCalled();
      expect(toast.warning).not.toHaveBeenCalled();
    });

    it('limpa o aviso anterior ao exportar de novo', async () => {
      vi.mocked(fetchCertProducts).mockResolvedValueOnce({ products: [], total: 0 });
      renderPage();
      await waitFor(() => expect(fetchCertReports).toHaveBeenCalled());

      await userEvent.click(screen.getByText('Todos os Produtos'));
      await screen.findByRole('status');

      await userEvent.click(screen.getByText('Todos os Produtos'));
      await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
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
