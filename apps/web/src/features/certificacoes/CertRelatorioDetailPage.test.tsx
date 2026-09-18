import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CertRelatorioDetailPage from './CertRelatorioDetailPage';
import { fetchCertReportDetail } from '@/shared/lib/cert-api-client';
import type { CertReportData } from '@/shared/lib/cert-api-client';

vi.mock('@/shared/lib/cert-api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/cert-api-client')>()),
  fetchCertReportDetail: vi.fn(),
}));

/**
 * Formato REAL gravado por `_run_validation` (apps/cert-api/app/routes/
 * certifications.py): chaves `run_id`, `date`, `summary`, `products`. Espelha
 * apps/cert-api/reports/validation_115cc9fc_*.json — a lista vem em `products`,
 * NAO em `results`. O fixture e montado como objeto solto (sem o tipo do
 * cliente) de proposito: e o contrato do backend, nao o que o front gostaria.
 */
const REAL_PRODUCTS = [
  {
    sku: '010203001',
    name: 'Lancheira Termica Dino',
    brand: 'puket',
    status: 'OK',
    score: 0.95,
    url: 'https://www.puket.com.br/lancheira-dino/p',
    actual_cert_text: 'Certificado INMETRO 001',
    certification_type: 'INMETRO',
    expected_cert_text: 'Certificado INMETRO 001',
    error: null,
  },
  {
    sku: '010203002',
    name: 'Estojo Unicornio',
    brand: 'puket',
    status: 'INCONSISTENT',
    score: 0.42,
    url: 'https://www.puket.com.br/estojo-unicornio/p',
    actual_cert_text: 'Outro texto',
    certification_type: 'INMETRO',
    expected_cert_text: 'Certificado INMETRO 002',
    error: null,
  },
  {
    sku: '990001',
    name: 'Luminaria Cogumelo',
    brand: 'imaginarium',
    status: 'URL_NOT_FOUND',
    score: 0.0,
    url: null,
    actual_cert_text: null,
    certification_type: 'INMETRO',
    expected_cert_text: '',
    error: 'Produto nao encontrado na VTEX',
  },
];

const REAL_REPORT = {
  run_id: '115cc9fc-7ab1-46b9-8c79-83b342b6354c',
  date: '2026-03-07T21:30:29.404736+00:00',
  summary: { total: 3, ok: 1, missing: 0, inconsistent: 1, not_found: 1 },
  products: REAL_PRODUCTS,
};

function mockReport(payload: unknown) {
  vi.mocked(fetchCertReportDetail).mockResolvedValue(payload as CertReportData);
}

function renderDetail(entry = '/certificacoes/relatorios/validation_115cc9fc.json') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/certificacoes/relatorios/:id" element={<CertRelatorioDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(fetchCertReportDetail).mockReset();
  vi.mocked(fetchCertReportDetail).mockRejectedValue(new Error('Unavailable'));
});

it('preserves percent sequences already decoded by the router', async () => {
  renderDetail('/certificacoes/relatorios/relatorio%2525.json');
  await waitFor(() => expect(fetchCertReportDetail).toHaveBeenCalledWith('relatorio%25.json'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Erro ao carregar relatório');
});

it('lista os produtos do relatorio no formato real gravado pelo backend (chave products)', async () => {
  mockReport(REAL_REPORT);
  renderDetail();

  expect(await screen.findByText('010203001')).toBeInTheDocument();
  expect(screen.getByText('Lancheira Termica Dino')).toBeInTheDocument();
  expect(screen.getByText('990001')).toBeInTheDocument();
  expect(screen.getByText('3 de 3 resultados')).toBeInTheDocument();

  const row = screen.getByText('010203002').closest('tr') as HTMLElement;
  expect(within(row).getByText('Estojo Unicornio')).toBeInTheDocument();
  expect(within(row).getByText('puket')).toBeInTheDocument();
  expect(within(row).getByText('Inconsistente')).toBeInTheDocument();
  expect(within(row).getByText('42%')).toBeInTheDocument();
  expect(within(row).getByRole('link', { name: /Abrir/ })).toHaveAttribute(
    'href',
    'https://www.puket.com.br/estojo-unicornio/p',
  );

  // Linha sem URL nao renderiza link.
  const semUrl = screen.getByText('990001').closest('tr') as HTMLElement;
  expect(within(semUrl).queryByRole('link')).not.toBeInTheDocument();
});

it('filtra por status e marca a partir dos itens de products', async () => {
  mockReport(REAL_REPORT);
  renderDetail();
  await screen.findByText('010203001');

  await userEvent.selectOptions(screen.getByLabelText('Filtrar marca'), 'imaginarium');
  expect(screen.getByText('1 de 3 resultados')).toBeInTheDocument();
  expect(screen.queryByText('010203001')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
  await userEvent.selectOptions(screen.getByLabelText('Filtrar status'), 'OK');
  expect(screen.getByText('1 de 3 resultados')).toBeInTheDocument();
  expect(screen.getByText('010203001')).toBeInTheDocument();
});

it('rotula no filtro todo status que o validador grava, inclusive EXPIRED', async () => {
  // `validate_single_product` devolve EXPIRED para prazo de venda vencido; o
  // filtro mostrava o codigo cru enquanto o selo da linha dizia "Vencido".
  mockReport({
    ...REAL_REPORT,
    products: [...REAL_PRODUCTS, { ...REAL_PRODUCTS[0], sku: '770001', status: 'EXPIRED' }],
  });
  renderDetail();
  await screen.findByText('770001');

  const select = screen.getByLabelText('Filtrar status');
  expect(within(select).getByRole('option', { name: 'Vencido' })).toHaveValue('EXPIRED');
  expect(within(select).queryByRole('option', { name: 'EXPIRED' })).not.toBeInTheDocument();
});

it('continua lendo relatorios legados que usam a chave results', async () => {
  mockReport({ summary: REAL_REPORT.summary, results: REAL_PRODUCTS.slice(0, 1) });
  renderDetail();

  expect(await screen.findByText('010203001')).toBeInTheDocument();
  expect(screen.getByText('1 de 1 resultados')).toBeInTheDocument();
});

it('explica o vazio quando a validacao nao processou nenhum produto', async () => {
  // Conteudo literal de apps/cert-api/reports/validation_115cc9fc_20260307_213029.json
  mockReport({
    run_id: '115cc9fc-7ab1-46b9-8c79-83b342b6354c',
    date: '2026-03-07T21:30:29.404736+00:00',
    summary: { total: 0, ok: 0, missing: 0, inconsistent: 0, not_found: 0 },
    products: [],
  });
  renderDetail();

  expect(
    await screen.findByText('Esta validação não processou nenhum produto'),
  ).toBeInTheDocument();
  expect(
    screen.queryByText('Nenhum resultado encontrado com os filtros aplicados'),
  ).not.toBeInTheDocument();
});
