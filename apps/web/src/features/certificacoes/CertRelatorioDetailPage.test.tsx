import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CertRelatorioDetailPage from './CertRelatorioDetailPage';
import { fetchCertReportDetail } from '@/shared/lib/cert-api-client';

vi.mock('@/shared/lib/cert-api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/cert-api-client')>()),
  fetchCertReportDetail: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(fetchCertReportDetail).mockReset();
  vi.mocked(fetchCertReportDetail).mockRejectedValue(new Error('Unavailable'));
});

it('preserves percent sequences already decoded by the router', async () => {
  render(
    <MemoryRouter initialEntries={['/certificacoes/relatorios/relatorio%2525.json']}>
      <Routes>
        <Route path="/certificacoes/relatorios/:id" element={<CertRelatorioDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(fetchCertReportDetail).toHaveBeenCalledWith('relatorio%25.json'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Erro ao carregar relatório');
});
