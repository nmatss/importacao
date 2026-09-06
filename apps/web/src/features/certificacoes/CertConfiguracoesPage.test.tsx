import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import CertConfiguracoesPage from './CertConfiguracoesPage';
import { checkCertApiHealth, fetchCertStats } from '@/shared/lib/cert-api-client';

vi.mock('@/shared/lib/cert-api-client', () => ({
  checkCertApiHealth: vi.fn(),
  fetchCertStats: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(checkCertApiHealth).mockResolvedValue({ connected: true, latencyMs: 12 });
  vi.mocked(fetchCertStats).mockResolvedValue({ total_products: 0 });
});

it('describes database statistics without claiming a live Sheets connection', async () => {
  render(<CertConfiguracoesPage />);
  expect(await screen.findByText('Dados disponíveis')).toBeInTheDocument();
  expect(screen.getByText('Base de produtos')).toBeInTheDocument();
  expect(screen.queryByText('Conectado')).not.toBeInTheDocument();
  expect(screen.getByText('0')).toBeInTheDocument();
});

it('shows unavailable data when the statistics request fails', async () => {
  vi.mocked(fetchCertStats).mockRejectedValue(new Error('Database unavailable'));
  render(<CertConfiguracoesPage />);
  expect(await screen.findByText('Erro ao ler dados')).toBeInTheDocument();
  expect(screen.queryByText('Dados disponíveis')).not.toBeInTheDocument();
  expect(screen.getByText('Indisponível')).toBeInTheDocument();
});
