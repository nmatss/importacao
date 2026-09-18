import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { StrictMode } from 'react';
import { toast } from 'sonner';
import { formatDateTime } from '@/shared/lib/utils';
import { matchesStatusFilters } from './CertProdutosPage';
import type { CertProduct, CertProductsResponse } from '@/shared/lib/cert-api-client';

vi.mock('@/shared/hooks/useAuth', () => ({ useAuth: () => ({ user: { role: 'analyst' } }) }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/shared/lib/cert-api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/lib/cert-api-client')>();
  return {
    ...actual,
    fetchCertProducts: vi.fn(),
    downloadCertApiResource: vi.fn(),
    verifyCertProduct: vi.fn(),
    fetchCertGrifes: vi.fn(),
    fetchLastCertSync: vi.fn(),
    syncCertSheets: vi.fn(),
  };
});

import {
  certProductQuery,
  upcomingLicenseFilters,
  downloadCertApiResource,
  fetchCertGrifes,
  fetchCertProducts,
  fetchLastCertSync,
  syncCertSheets,
} from '@/shared/lib/cert-api-client';
import CertProdutosPage, { certificateNumberLines } from './CertProdutosPage';

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

function renderPage(path = '/certificacoes/produtos') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <CertProdutosPage />
    </MemoryRouter>,
  );
}

const mockedGrifes = vi.mocked(fetchCertGrifes);
const mockedLastSync = vi.mocked(fetchLastCertSync);
const mockedSync = vi.mocked(syncCertSheets);

describe('CertProdutosPage (server-authoritative)', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    mockedGrifes.mockReset();
    mockedLastSync.mockReset();
    mockedSync.mockReset();
    mockedGrifes.mockResolvedValue({ grifes: [], sem_grife: 0 });
    mockedLastSync.mockResolvedValue({ last_run: null });
  });

  it('separa validade, prazo e pendência comercial com a origem do problema', async () => {
    mockedFetch.mockResolvedValue({
      products: [
        {
          sku: '050404509',
          brand: 'Puket',
          name: 'Certificado ativo',
          cert_status: 'ATIVO',
          validade_certificado: '2027-03-22',
          sale_deadline: '',
          status_venda: 'BLOQUEADA',
          status_venda_reason: 'Licenciamento ainda não consultado no Linx',
          license_status: 'PENDENTE',
        },
      ],
      total: 1,
    });
    renderPage();
    const row = (await screen.findByText('Certificado ativo')).closest('tr') as HTMLElement;
    expect(within(row).getByText('22/03/2027')).toBeInTheDocument();
    expect(within(row).getByText('Licenciamento ainda não consultado no Linx')).toBeInTheDocument();
    expect(within(row).getAllByText('Pendente de validação').length).toBe(2);
    expect(within(row).queryByText('Bloqueada')).not.toBeInTheDocument();
  });

  it('keeps the newest filter results when an older request finishes later', async () => {
    let finishOld!: (value: CertProductsResponse) => void;
    mockedFetch.mockImplementationOnce(
      () =>
        new Promise<CertProductsResponse>((resolve) => {
          finishOld = resolve;
        }),
    );
    mockedFetch.mockResolvedValue({
      products: [{ sku: 'NEW', brand: 'Puket', name: 'Resultado atual' }],
      total: 1,
    });
    renderPage();
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Puket' }));
    expect(await screen.findByText('Resultado atual')).toBeInTheDocument();
    await act(async () => {
      finishOld({
        products: [{ sku: 'OLD', brand: 'Imaginarium', name: 'Resultado antigo' }],
        total: 1,
      });
    });
    expect(screen.getByText('Resultado atual')).toBeInTheDocument();
    expect(screen.queryByText('Resultado antigo')).not.toBeInTheDocument();
  });

  it('keeps the newest filter results when an older request finishes later', async () => {
    let finishOld!: (value: CertProductsResponse) => void;
    mockedFetch.mockImplementationOnce(
      () =>
        new Promise<CertProductsResponse>((resolve) => {
          finishOld = resolve;
        }),
    );
    mockedFetch.mockResolvedValue({
      products: [{ sku: 'NEW', brand: 'Puket', name: 'Resultado atual' }],
      total: 1,
    });
    renderPage();
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Puket' }));
    expect(await screen.findByText('Resultado atual')).toBeInTheDocument();
    await act(async () => {
      finishOld({
        products: [{ sku: 'OLD', brand: 'Imaginarium', name: 'Resultado antigo' }],
        total: 1,
      });
    });
    expect(screen.getByText('Resultado atual')).toBeInTheDocument();
    expect(screen.queryByText('Resultado antigo')).not.toBeInTheDocument();
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

describe('certificateNumberLines', () => {
  it('quebra numeros de recertificacao em linhas e ignora vazios', () => {
    expect(certificateNumberLines('6916-2021-BRI-1\n MT-5493/2021')).toEqual([
      '6916-2021-BRI-1',
      'MT-5493/2021',
    ]);
    expect(certificateNumberLines('   ')).toEqual([]);
    expect(certificateNumberLines(null)).toEqual([]);
    expect(certificateNumberLines(undefined)).toEqual([]);
  });
});

describe('CertProdutosPage — numero do certificado, grife e sync', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    mockedGrifes.mockReset();
    mockedLastSync.mockReset();
    mockedSync.mockReset();
    mockedGrifes.mockResolvedValue({ grifes: [], sem_grife: 0 });
    mockedLastSync.mockResolvedValue({ last_run: null });
    mockedFetch.mockResolvedValue({
      products: [
        {
          sku: 'PI1',
          brand: 'Puket',
          name: 'Produto com certificado',
          numero_certificado: '10584/2024-AE-1',
        },
        { sku: 'PI2', brand: 'Puket', name: 'Produto sem certificado' },
      ],
      total: 2,
      total_pages: 1,
    });
  });

  it('exibe o numero do certificado na lista', async () => {
    renderPage();
    expect(await screen.findByText('10584/2024-AE-1')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Nº Certificado' })).toBeInTheDocument();
  });

  it('mostra o filtro de grife com a cobertura real e envia o valor a API', async () => {
    mockedGrifes.mockResolvedValue({
      grifes: [
        { grife: 'MARVEL', count: 248 },
        { grife: 'DISNEY', count: 144 },
      ],
      sem_grife: 31,
    });
    renderPage();

    const select = await screen.findByLabelText('Grife / licença');
    expect(screen.getByText(/31 produtos sem grife preenchida no Linx/)).toBeInTheDocument();

    fireEvent.change(select, { target: { value: 'MARVEL' } });

    await waitFor(() =>
      expect(mockedFetch).toHaveBeenLastCalledWith(
        expect.objectContaining({ grife: 'MARVEL', page: 1 }),
      ),
    );
  });

  it('nao mostra o filtro de grife quando o Linx ainda nao foi sincronizado', async () => {
    renderPage();
    await waitFor(() => expect(mockedFetch).toHaveBeenCalled());
    expect(screen.queryByLabelText('Grife / licença')).not.toBeInTheDocument();
  });

  it('o botao de sincronizar chama POST /api/sync-sheets, nao so recarrega a lista', async () => {
    mockedSync.mockResolvedValue({
      locked: true,
      trigger: 'manual',
      run_id: 'r1',
      sheets: { synced: 674 },
    });
    renderPage();
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: /Sincronizar planilha agora/ }));

    await waitFor(() => expect(mockedSync).toHaveBeenCalledOnce());
    // Recarrega a lista DEPOIS do sync — senao a tela seguiria com o dado velho.
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(2));
    expect(mockedLastSync).toHaveBeenCalledTimes(2);
  });

  it('não anuncia sucesso quando Sheets aplica e Linx falha', async () => {
    vi.mocked(toast.success).mockClear();
    mockedSync.mockResolvedValue({
      locked: true,
      trigger: 'manual',
      run_id: 'r2',
      status: 'error',
      error: 'Linx indisponível',
      sheets: { synced: 2 },
      linx: { error: 'Timeout' },
    });
    renderPage();
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: /Sincronizar planilha agora/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Linx indisponível'));
    expect(toast.success).not.toHaveBeenCalled();
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it('mostra a ultima sincronizacao com o ator, em portugues', async () => {
    mockedLastSync.mockResolvedValue({
      last_run: {
        id: 'r1',
        trigger: 'manual',
        actor: 'odett@grupounico.com',
        started_at: '2026-09-11T15:00:00+00:00',
        finished_at: '2026-09-11T15:00:20+00:00',
        result: null,
        error: null,
      },
    });
    renderPage();

    expect(
      await screen.findByText(/Última sincronização da planilha:.*odett@grupounico.com/),
    ).toBeInTheDocument();
  });

  it('rotula o gatilho automatico em portugues, nunca a chave tecnica', async () => {
    mockedLastSync.mockResolvedValue({
      last_run: {
        id: 'r1',
        trigger: 'hourly',
        actor: null,
        started_at: '2026-09-11T15:00:00+00:00',
        finished_at: '2026-09-11T15:00:20+00:00',
        result: null,
        error: null,
      },
    });
    renderPage();

    expect(await screen.findByText(/automática \(a cada hora\)/)).toBeInTheDocument();
    expect(screen.queryByText(/hourly/)).not.toBeInTheDocument();
  });

  it('mostra o motivo real da falha da planilha, nao so o resumo da execucao', async () => {
    mockedLastSync.mockResolvedValue({
      last_run: {
        id: 'r1',
        trigger: 'hourly',
        actor: null,
        started_at: '2026-09-18T10:20:00+00:00',
        finished_at: '2026-09-18T10:20:10+00:00',
        result: {
          sheets: { synced: 0, error: 'Esquema de Encerramentos invalido: prazo final venda' },
          linx: { skipped: true },
        },
        error: 'Sincronizacao da planilha falhou; etapa Linx nao executada',
      },
    });
    renderPage();

    expect(
      await screen.findByText(/Motivo: Esquema de Encerramentos invalido: prazo final venda\./),
    ).toBeInTheDocument();
  });

  it('lista os SKUs com vinculo de certificado a conferir quando o sync passa', async () => {
    mockedLastSync.mockResolvedValue({
      last_run: {
        id: 'r1',
        trigger: 'hourly',
        actor: null,
        started_at: '2026-09-18T10:20:00+00:00',
        finished_at: '2026-09-18T10:20:10+00:00',
        result: {
          sheets: {
            synced: 947,
            pendencias_total: 2,
            pendencias: [{ sku: 'PI4368Y' }, { sku: '050403623' }],
          },
        },
        error: null,
      },
    });
    renderPage();

    expect(
      await screen.findByText(/2 SKU\(s\) sincronizado\(s\).*PI4368Y, 050403623/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/falhou/)).not.toBeInTheDocument();
  });

  it('a falha da sincronizacao e um alerta de verdade, no topo', async () => {
    mockedLastSync.mockResolvedValue({
      last_run: {
        id: 'r1',
        trigger: 'hourly',
        actor: null,
        started_at: '2026-09-18T10:20:00+00:00',
        finished_at: '2026-09-18T10:20:10+00:00',
        result: {
          sheets: { synced: 0, error: 'Aba Puket sem cabecalho' },
          linx: { skipped: true },
        },
        error: 'Sincronizacao da planilha falhou',
      },
    });
    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Motivo: Aba Puket sem cabecalho.');
    expect(alert).toHaveTextContent('do Linx também não foram lidos');
  });

  it('filtro de licenciamento vazio sem o Linx lido nao se passa por "nao ha vencidos"', async () => {
    // Tela da Lilian em 17/09/2026: Encerrado + Vencido = 0, com o Linx nunca lido.
    mockedFetch.mockResolvedValue({ products: [], total: 0 });
    mockedLastSync.mockResolvedValue({
      last_run: {
        id: 'r1',
        trigger: 'hourly',
        actor: null,
        started_at: '2026-09-18T10:20:00+00:00',
        finished_at: '2026-09-18T10:20:10+00:00',
        result: { sheets: { synced: 0, error: 'x' }, linx: { skipped: true } },
        error: 'Sincronizacao da planilha falhou',
      },
    });
    renderPage();
    await waitFor(() => expect(mockedFetch).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Vencido' }));

    expect(await screen.findByText(/licenciamento ainda não foi lido do Linx/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver licenciamento pendente' }));
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenLastCalledWith(
        expect.objectContaining({ license_status: 'PENDENTE' }),
      ),
    );
  });

  it('com o Linx lido, o vazio do filtro de licenciamento e so um vazio', async () => {
    mockedFetch.mockResolvedValue({ products: [], total: 0 });
    mockedLastSync.mockResolvedValue({
      last_run: {
        id: 'r1',
        trigger: 'hourly',
        actor: null,
        started_at: '2026-09-18T10:20:00+00:00',
        finished_at: '2026-09-18T10:20:10+00:00',
        result: { sheets: { synced: 947 }, linx: { updated: 674, errors: [] } },
        error: null,
      },
    });
    renderPage();
    await waitFor(() => expect(mockedFetch).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Vencido' }));

    expect(await screen.findByText('Ajuste os filtros ou busca')).toBeInTheDocument();
    expect(screen.queryByText(/ainda não foi lido do Linx/)).not.toBeInTheDocument();
  });

  it('falha no botao de sincronizar recarrega a ultima execucao', async () => {
    mockedFetch.mockResolvedValue({ products: [], total: 0 });
    mockedSync.mockRejectedValue(new Error('Sincronizacao da planilha falhou. Motivo: x'));
    renderPage();
    await waitFor(() => expect(mockedLastSync).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: /Sincronizar planilha agora/ }));

    await waitFor(() => expect(mockedLastSync).toHaveBeenCalledTimes(2));
  });

  it('nao esconde a lista quando a ultima sincronizacao falha ao carregar', async () => {
    mockedLastSync.mockRejectedValue(new Error('Erro na API: 503'));
    renderPage();
    expect(await screen.findByText('Produto com certificado')).toBeInTheDocument();
  });
});

describe('licenciamento somente leitura', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetch.mockResolvedValue({
      products: [
        {
          sku: 'SKU-LIC',
          name: 'Descrição licenciada',
          brand: 'Puket',
          license_deadline: '2026-10-02',
          linx_synced_at: '2026-09-18T12:00:00Z',
        },
      ],
      total: 1,
    });
    mockedGrifes.mockResolvedValue({ grifes: [], sem_grife: 0 });
    mockedLastSync.mockResolvedValue({ last_run: null });
    vi.mocked(downloadCertApiResource).mockResolvedValue(undefined);
  });

  it('faixa sem leitura Linx explica o vazio e acesso a pendentes remove a faixa', async () => {
    mockedFetch.mockResolvedValue({ products: [], total: 0 });
    renderPage('/certificacoes/produtos?license_start_date=2026-09-18&license_end_date=2026-10-17');
    expect(await screen.findByText(/ainda não foi lido do Linx/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver licenciamento pendente' }));
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenLastCalledWith(
        expect.objectContaining({
          license_status: 'PENDENTE',
          license_start_date: undefined,
          license_end_date: undefined,
        }),
      ),
    );
    const range = screen.getByRole('group', { name: 'Vencimento do licenciamento (Linx)' });
    expect(within(range).getByLabelText('De')).toHaveValue('');
    expect(within(range).getByLabelText('Até')).toHaveValue('');
  });

  it('restaura faixa e status ao voltar e avançar sem atualizar router durante render', async () => {
    function HistoryControls() {
      const navigate = useNavigate();
      return (
        <>
          <button onClick={() => navigate(-1)}>Voltar histórico</button>
          <button onClick={() => navigate(1)}>Avançar histórico</button>
        </>
      );
    }
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <StrictMode>
          <MemoryRouter
            initialEntries={[
              '/certificacoes/produtos?license_start_date=2026-09-18&license_end_date=2026-10-17',
            ]}
          >
            <HistoryControls />
            <CertProdutosPage />
          </MemoryRouter>
        </StrictMode>,
      );
      await screen.findByText('Descrição licenciada');
      fireEvent.click(screen.getByRole('button', { name: 'Ativo' }));
      await waitFor(() =>
        expect(mockedFetch).toHaveBeenLastCalledWith(
          expect.objectContaining({ cert_status: 'ATIVO' }),
        ),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Licenciamentos vencidos' }));
      await waitFor(() =>
        expect(mockedFetch).toHaveBeenLastCalledWith(
          expect.objectContaining({ license_status: 'VENCIDO', license_start_date: undefined }),
        ),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Voltar histórico' }));
      await waitFor(() =>
        expect(mockedFetch).toHaveBeenLastCalledWith(
          expect.objectContaining({
            cert_status: 'ATIVO',
            license_status: undefined,
            license_start_date: '2026-09-18',
            license_end_date: '2026-10-17',
          }),
        ),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Avançar histórico' }));
      await waitFor(() =>
        expect(mockedFetch).toHaveBeenLastCalledWith(
          expect.objectContaining({
            cert_status: 'ATIVO',
            license_status: 'VENCIDO',
            license_start_date: undefined,
            license_end_date: undefined,
          }),
        ),
      );
      expect(error.mock.calls.flat().join(' ')).not.toMatch(/Cannot update a component/);
    } finally {
      error.mockRestore();
    }
  });

  it('usa o dia de São Paulo e trinta datas inclusivas na virada de mês/ano', () => {
    expect(upcomingLicenseFilters(new Date('2027-01-01T01:30:00Z'))).toEqual({
      license_start_date: '2026-12-31',
      license_end_date: '2027-01-29',
    });
  });

  it('preserva faixa ao trocar status e exporta os mesmos filtros sem paginacao', async () => {
    renderPage('/certificacoes/produtos?license_start_date=2026-09-18&license_end_date=2026-10-17');
    await screen.findByText('Descrição licenciada');
    expect(screen.getByText(/Linx lido em/)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Data da validação' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ativo' }));
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenLastCalledWith(
        expect.objectContaining({
          cert_status: 'ATIVO',
          license_start_date: '2026-09-18',
          license_end_date: '2026-10-17',
          page: 1,
        }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Puket' }));
    await screen.findByText('Descrição licenciada');
    fireEvent.click(screen.getByRole('button', { name: 'Exportar produtos filtrados' }));
    await waitFor(() => expect(downloadCertApiResource).toHaveBeenCalled());
    const [url] = vi.mocked(downloadCertApiResource).mock.calls[0];
    const query = new URL(String(url), 'https://example.invalid').searchParams;
    const current = mockedFetch.mock.calls.at(-1)![0]!;
    const filters = { ...current, page: undefined, per_page: undefined };
    expect(query.toString()).toBe(certProductQuery(filters));
    expect(query.has('page')).toBe(false);
    expect(query.has('per_page')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenLastCalledWith(
        expect.objectContaining({
          license_start_date: undefined,
          license_end_date: undefined,
          cert_status: undefined,
        }),
      ),
    );
  });

  it('bloqueia intervalo invertido e não faz consulta ou exportacao inválida', async () => {
    renderPage('/certificacoes/produtos?license_start_date=2026-10-18&license_end_date=2026-09-18');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Exportar produtos filtrados' })).toBeDisabled(),
    );
    expect(mockedFetch).not.toHaveBeenCalled();
    expect(downloadCertApiResource).not.toHaveBeenCalled();
    expect(screen.getAllByText(/início do período de licenciamento/).length).toBeGreaterThan(0);
  });

  it('atalhos vencidos e próximos 30 dias não deixam filtros incompatíveis', async () => {
    renderPage('/certificacoes/produtos?license_status=VENCIDO');
    await screen.findByText('Descrição licenciada');
    fireEvent.click(screen.getByRole('button', { name: 'Próximos 30 dias' }));
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenLastCalledWith(
        expect.objectContaining({
          ...upcomingLicenseFilters(),
          license_status: undefined,
        }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Licenciamentos vencidos' }));
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenLastCalledWith(
        expect.objectContaining({
          license_status: 'VENCIDO',
          license_start_date: undefined,
          license_end_date: undefined,
        }),
      ),
    );
  });
});
