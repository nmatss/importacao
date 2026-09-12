import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/shared/lib/api-client', () => ({
  api: { post: vi.fn() },
}));

const mockRefetch = vi.fn();

vi.mock('@/shared/hooks/useApi', () => ({
  useApiQuery: vi.fn(),
}));

import { useApiQuery } from '@/shared/hooks/useApi';
import { DocumentComparison } from './DocumentComparison';

function renderComparison() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DocumentComparison processId="1" />
    </QueryClientProvider>,
  );
}

type QueryResult = ReturnType<typeof useApiQuery>;

function ok<T>(data: T): QueryResult {
  return {
    data,
    isLoading: false,
    isError: false,
    error: null,
    refetch: mockRefetch,
  } as unknown as QueryResult;
}

/**
 * Wires up the three queries the component reads: doc-comparison,
 * process-events and validation-report. Pass overrides per key.
 */
function mockQueries(overrides: { comparison?: unknown; events?: unknown; report?: unknown }) {
  vi.mocked(useApiQuery).mockImplementation((queryKey: readonly unknown[]) => {
    const key = Array.isArray(queryKey) ? queryKey[0] : null;
    if (key === 'process-events') return ok(overrides.events ?? []);
    if (key === 'validation-report') return ok(overrides.report ?? undefined);
    return ok(overrides.comparison ?? undefined);
  });
}

const baseComparison = {
  hasInvoice: true,
  hasPackingList: true,
  hasBl: true,
  hasEspelho: true,
  aggregateComparison: [],
  itemComparison: [],
  unmatchedPlItems: [],
  invoiceConfidence: 0.9,
  plConfidence: 0.9,
  blConfidence: 0.9,
};

describe('DocumentComparison', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows an error state instead of the empty state when comparison loading fails', () => {
    vi.mocked(useApiQuery).mockImplementation((queryKey: readonly unknown[]) => {
      const key = Array.isArray(queryKey) ? queryKey[0] : null;
      return {
        data: key === 'process-events' ? [] : undefined,
        isLoading: false,
        isError: key === 'doc-comparison',
        error: key === 'doc-comparison' ? new Error('boom') : null,
        refetch: mockRefetch,
      } as unknown as ReturnType<typeof useApiQuery>;
    });

    renderComparison();

    expect(screen.getByRole('alert')).toHaveTextContent(/Erro ao carregar comparativo documental/i);
    expect(screen.queryByText(/Nenhum dado disponivel/i)).not.toBeInTheDocument();
  });

  it('renders separate net and gross weight columns with per-source values', () => {
    mockQueries({
      comparison: {
        ...baseComparison,
        itemComparison: [
          {
            itemCode: 'SKU-1',
            description: 'Produto A',
            ncm: '1234',
            invoiceQty: 10,
            plQty: 10,
            espelhoQty: 10,
            invoiceUnitPrice: 5,
            invoiceTotal: 50,
            invoiceBoxes: 1,
            plBoxes: 1,
            espelhoBoxes: 1,
            invoiceNetWeight: 12.5,
            plNetWeight: 12.5,
            espelhoNetWeight: 12.5,
            invoiceGrossWeight: 15,
            plGrossWeight: 15,
            espelhoGrossWeight: 15,
            qtyMatch: true,
            matched: true,
            espelhoMatched: true,
          },
        ],
      },
    });

    renderComparison();

    expect(screen.getByRole('columnheader', { name: /Peso Liquido/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Peso Bruto/i })).toBeInTheDocument();
    // Net weight value present
    expect(screen.getAllByText(/12,50/).length).toBeGreaterThan(0);
    // Gross weight value present
    expect(screen.getAllByText(/15,00/).length).toBeGreaterThan(0);
  });

  it('renders a Caixas column with per-source box counts', () => {
    mockQueries({
      comparison: {
        ...baseComparison,
        itemComparison: [
          {
            itemCode: 'SKU-1',
            description: 'Produto A',
            ncm: '1234',
            invoiceQty: 10,
            plQty: 10,
            espelhoQty: 10,
            invoiceUnitPrice: 5,
            invoiceTotal: 50,
            invoiceBoxes: 3,
            plBoxes: 4,
            espelhoBoxes: 5,
            invoiceNetWeight: 12.5,
            plNetWeight: 12.5,
            espelhoNetWeight: 12.5,
            invoiceGrossWeight: 15,
            plGrossWeight: 15,
            espelhoGrossWeight: 15,
            qtyMatch: true,
            matched: true,
            espelhoMatched: true,
          },
        ],
      },
    });

    renderComparison();

    expect(screen.getByRole('columnheader', { name: /^Caixas$/i })).toBeInTheDocument();
    const row = screen.getByText('Produto A').closest('tr') as HTMLTableRowElement;
    // Box counts are integers (no decimals) and shown per source.
    expect(within(row).getByText('3')).toBeInTheDocument();
    expect(within(row).getByText('4')).toBeInTheDocument();
    expect(within(row).getByText('5')).toBeInTheDocument();
  });

  it('shows a Sistema column with the value the API resolved from the process', () => {
    // A coluna Sistema vem PRONTA do comparativo (cadastro do processo,
    // alimentado pela Follow-up). Antes ela era derivada de um check de
    // validacao persistido, e um processo com so runs parciais — o PK220 —
    // exibia tracinho em todas as linhas.
    mockQueries({
      comparison: {
        ...baseComparison,
        systemDataAvailable: true,
        aggregateComparison: [
          {
            rowKey: 'aggregate:total-fob-usd',
            label: 'Total FOB (USD)',
            invoice: '$1.000,00',
            packingList: null,
            bl: null,
            espelho: null,
            system: '$1.200,00',
            status: 'divergent',
          },
        ],
      },
    });

    renderComparison();

    expect(screen.getByRole('columnheader', { name: /^Sistema$/i })).toBeInTheDocument();
    expect(screen.getByText('$1.200,00')).toBeInTheDocument();
  });

  it('shows extraction coverage diagnostics returned by the API', () => {
    mockQueries({
      comparison: {
        ...baseComparison,
        extractionCoverage: {
          invoice: {
            readPercent: 80,
            effectiveReadPercent: 62,
            trackedMissingFields: ['portOfLoading', 'totalGrossWeight'],
            missingFields: ['portOfLoading'],
            lowConfidenceFields: ['exporterName'],
          },
        },
      },
    });

    renderComparison();

    expect(screen.getByText(/Diagnostico da extracao documental/i)).toBeInTheDocument();
    expect(screen.getAllByText('Invoice').length).toBeGreaterThan(1);
    expect(screen.getByText('62%')).toBeInTheDocument();
    expect(screen.getByText(/portOfLoading, totalGrossWeight/i)).toBeInTheDocument();
    expect(screen.getByText(/exporterName/i)).toBeInTheDocument();
  });

  it('mostra a falha e a regra que reprovou na propria linha agregada', () => {
    mockQueries({
      comparison: {
        ...baseComparison,
        systemDataAvailable: true,
        aggregateComparison: [
          {
            rowKey: 'aggregate:total-fob-usd',
            label: 'Total FOB (USD)',
            invoice: '$1.000,00',
            packingList: '$1.000,00',
            bl: null,
            espelho: '$1.000,00',
            system: '$1.200,00',
            status: 'divergent',
            message: 'Valor da Invoice x Follow-up: Valor no sistema diverge dos documentos.',
          },
        ],
      },
    });

    renderComparison();

    const row = screen.getByText('Total FOB (USD)').closest('tr') as HTMLTableRowElement;
    expect(within(row).getByText('Falha')).toBeInTheDocument();
    expect(within(row).getByText(/Valor no sistema diverge/i)).toBeInTheDocument();
  });

  it('mostra "Nao verificado" fora da contagem de atencoes', () => {
    // Decisao D6: "o Odoo nao respondeu" e "frete ausente na follow-up" sao
    // verificacoes NAO REALIZADAS — visiveis, mas fora das pendencias.
    mockQueries({
      comparison: {
        ...baseComparison,
        aggregateComparison: [
          {
            rowKey: 'aggregate:frete',
            label: 'Frete',
            invoice: null,
            packingList: null,
            bl: null,
            espelho: null,
            system: null,
            status: 'skipped',
            message: 'Nao verificado — Nenhum valor de frete disponivel nos dados do follow-up',
          },
        ],
      },
    });

    renderComparison();

    const row = screen.getByText('Frete').closest('tr') as HTMLTableRowElement;
    expect(within(row).getByText('Não verificado')).toBeInTheDocument();
    expect(within(row).getByText(/Nenhum valor de frete disponivel/i)).toBeInTheDocument();

    const atencoes = screen.getByRole('button', { name: /Atencoes/i });
    expect(within(atencoes).getByText('0')).toBeInTheDocument();
    const naoVerificados = screen.getByRole('button', { name: /Nao verificados/i });
    expect(within(naoVerificados).getByText('1')).toBeInTheDocument();
  });

  it('resume falhas, atencoes e conformes num unico bloco clicavel e colorido', () => {
    // Reuniao 11/09 [04:22]: havia dois resumos, um clicavel sem cor e outro
    // colorido sem clique, com as mesmas contagens.
    mockQueries({
      comparison: {
        ...baseComparison,
        aggregateComparison: [
          {
            rowKey: 'aggregate:incoterm',
            label: 'Incoterm',
            invoice: 'FOB',
            packingList: 'FOB',
            bl: null,
            espelho: null,
            system: null,
            status: 'match',
          },
          {
            rowKey: 'aggregate:moeda',
            label: 'Moeda',
            invoice: 'USD',
            packingList: 'BRL',
            bl: null,
            espelho: null,
            system: null,
            status: 'divergent',
          },
        ],
      },
    });

    renderComparison();

    const conformes = screen.getByRole('button', { name: /Conformes/i });
    expect(conformes.className).toContain('emerald');
    expect(within(conformes).getByText('1')).toBeInTheDocument();
    const falhas = screen.getByRole('button', { name: /Falhas/i });
    expect(falhas.className).toContain('danger');
    expect(falhas).toHaveAttribute('aria-pressed', 'false');
    // Uma unica ocorrencia de cada contagem: o bloco duplicado saiu.
    expect(screen.queryByText(/1 conformes/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/1 falhas/i)).not.toBeInTheDocument();
  });

  it('shows a "sem dados do sistema" hint when system data is unavailable', () => {
    mockQueries({
      comparison: {
        ...baseComparison,
        aggregateComparison: [
          {
            rowKey: 'aggregate:incoterm',
            label: 'Verificação de Incoterm',
            invoice: 'FOB',
            packingList: null,
            bl: 'FOB',
            espelho: null,
            status: 'match',
          },
        ],
      },
      report: { systemDataAvailable: false, crossDocumentChecks: [], systemChecks: [] },
    });

    renderComparison();

    expect(screen.getAllByText(/sem dados do sistema/i).length).toBeGreaterThan(0);
  });

  it('treats Draft BL as operational BL in the partial comparison warning', () => {
    mockQueries({
      comparison: {
        ...baseComparison,
        hasBl: true,
        hasFinalBl: false,
        hasOperationalBl: true,
        hasDraftBl: true,
        operationalBlSource: 'draft_bl',
        hasEspelho: false,
        blConfidence: 0.88,
        draftBlConfidence: 0.88,
      },
    });

    renderComparison();

    expect(screen.getByText(/Draft BL \(operacional\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Comparativo parcial/i)).toBeInTheDocument();
    expect(screen.queryByText(/Bill of Lading ou Draft BL ausente/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Espelho ausente/i)).toBeInTheDocument();
  });

  it('mostra os cruzamentos nas colunas, sem o par "Esperado/Encontrado"', () => {
    // Reuniao 11/09 [12:08]: os cruzamentos vinham como texto solto, sem dizer
    // a fonte, e repetiam linhas de cima. Agora a API ja entrega tudo como
    // linha com valores POR DOCUMENTO; a tela nao remonta mais nada.
    mockQueries({
      comparison: {
        ...baseComparison,
        aggregateComparison: [
          {
            rowKey: 'aggregate:porto-embarque',
            label: 'Porto Embarque',
            invoice: 'Santos',
            packingList: 'Santos',
            bl: 'Itajai',
            espelho: null,
            system: null,
            status: 'divergent',
            message: 'Portos: Portos divergentes',
          },
          {
            rowKey: 'aggregate:ncm-bl-x-espelho',
            label: 'NCM (BL x Espelho)',
            invoice: null,
            packingList: null,
            bl: '4419',
            espelho: '4414',
            system: null,
            status: 'divergent',
            message: 'NCM do BL diverge do espelho.',
          },
        ],
      },
    });

    renderComparison();

    expect(screen.queryByText(/^Esperado$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Encontrado$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/cruzamento/i)).not.toBeInTheDocument();

    const portos = screen.getByText('Porto Embarque').closest('tr') as HTMLTableRowElement;
    expect(within(portos).getByText('Itajai')).toBeInTheDocument();
    expect(within(portos).getByText(/Portos divergentes/i)).toBeInTheDocument();

    // "NCM BL versus espelho" continua, agora com valor em cada coluna.
    const ncm = screen.getByText('NCM (BL x Espelho)').closest('tr') as HTMLTableRowElement;
    expect(within(ncm).getByText('4419')).toBeInTheDocument();
    expect(within(ncm).getByText('4414')).toBeInTheDocument();
  });

  it('renders both unmatched directions in a single unified section', () => {
    mockQueries({
      comparison: {
        ...baseComparison,
        unmatchedPlItems: [
          { itemCode: 'PL-1', description: 'Item so no PL', quantity: 5, source: 'pl' },
        ],
        unmatchedInvoiceItems: [
          { itemCode: 'INV-1', description: 'Item so na Invoice', quantity: 7, source: 'invoice' },
        ],
      },
    });

    renderComparison();

    // Both directions present under the one consolidated quadro.
    expect(
      screen.getByText(/Itens sem correspondencia entre Invoice e Packing List/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Itens no Packing List sem correspondencia na Invoice \(1\)/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Itens na Invoice sem correspondencia no Packing List \(1\)/i),
    ).toBeInTheDocument();
    expect(screen.getByText('Item so no PL')).toBeInTheDocument();
    expect(screen.getByText('Item so na Invoice')).toBeInTheDocument();
  });

  it('still renders the PL-without-Invoice direction when no invoice-only items exist', () => {
    mockQueries({
      comparison: {
        ...baseComparison,
        unmatchedPlItems: [
          { itemCode: 'PL-9', description: 'Apenas PL', quantity: 3, source: 'pl' },
        ],
      },
    });

    renderComparison();

    expect(
      screen.getByText(/Itens no Packing List sem correspondencia na Invoice \(1\)/i),
    ).toBeInTheDocument();
    expect(screen.getByText('Apenas PL')).toBeInTheDocument();
    expect(
      screen.queryByText(/Itens na Invoice sem correspondencia no Packing List/i),
    ).not.toBeInTheDocument();
  });

  it('confirma explicitamente quando todos os itens foram encontrados', () => {
    // Reuniao 11/09 [17:29]: o quadro so existia para o caso de erro; quando
    // estava tudo certo ele sumia e a analista ficava sem a confirmacao.
    mockQueries({
      comparison: {
        ...baseComparison,
        hasEspelho: false,
        unmatchedPlItems: [],
        unmatchedInvoiceItems: [],
        itemComparison: [
          {
            itemCode: '050404509',
            description: 'BACKPACK KIDS A',
            ncm: '42029200',
            invoiceQty: 1232,
            plQty: 1232,
            espelhoQty: null,
            invoiceUnitPrice: 1,
            invoiceTotal: 1232,
            espelhoUnitPrice: null,
            espelhoTotal: null,
            invoiceBoxes: null,
            plBoxes: null,
            espelhoBoxes: null,
            invoiceNetWeight: null,
            plNetWeight: null,
            espelhoNetWeight: null,
            invoiceGrossWeight: null,
            plGrossWeight: null,
            espelhoGrossWeight: null,
            qtyMatch: true,
            matched: true,
            espelhoMatched: false,
          },
        ],
      },
    });

    renderComparison();

    expect(
      screen.getByText(/Todos os 1 itens da Invoice foram encontrados no Packing List/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Itens sem correspondencia entre Invoice e Packing List/i),
    ).not.toBeInTheDocument();
  });

  it('nao mostra o verde de "todos encontrados" quando nao ha item extraido', () => {
    // Vazio nunca pode virar "tudo certo".
    mockQueries({
      comparison: {
        ...baseComparison,
        itemComparison: [],
        unmatchedPlItems: [],
        unmatchedInvoiceItems: [],
      },
    });

    renderComparison();

    expect(screen.getByText(/Sem itens extraidos para comparar/i)).toBeInTheDocument();
    expect(screen.queryByText(/foram encontrados no Packing List/i)).not.toBeInTheDocument();
  });

  it('mostra NCM, unitario e total do espelho ao lado dos da invoice', () => {
    mockQueries({
      comparison: {
        ...baseComparison,
        hasEspelho: true,
        itemComparison: [
          {
            itemCode: '050404509',
            description: 'BACKPACK KIDS A',
            ncm: '39264000',
            espelhoNcm: '42029200',
            ncmMatch: false,
            invoiceQty: 10,
            plQty: 10,
            espelhoQty: 10,
            invoiceUnitPrice: 5,
            espelhoUnitPrice: 6,
            unitPriceMatch: false,
            invoiceTotal: 50,
            espelhoTotal: 60,
            totalPriceMatch: false,
            invoiceBoxes: null,
            plBoxes: null,
            espelhoBoxes: null,
            invoiceNetWeight: null,
            plNetWeight: null,
            espelhoNetWeight: null,
            invoiceGrossWeight: null,
            plGrossWeight: null,
            espelhoGrossWeight: null,
            qtyMatch: true,
            matched: true,
            espelhoMatched: true,
            status: 'divergent',
          },
        ],
      },
    });

    renderComparison();

    const row = screen.getByText('BACKPACK KIDS A').closest('tr') as HTMLTableRowElement;
    expect(within(row).getByText('39264000')).toBeInTheDocument();
    expect(within(row).getByText('42029200')).toBeInTheDocument();
    expect(within(row).getByText('$5,00')).toBeInTheDocument();
    expect(within(row).getByText('$6,00')).toBeInTheDocument();
    expect(within(row).getByText('$60,00')).toBeInTheDocument();
  });

  it('nao exibe "Aceito" so porque existe evento no timeline', async () => {
    // O defeito: a tela derivava o aceite de `process_events`, e
    // `invalidateComparisonAcceptances()` — chamada em reprocessamento e
    // reclassificacao de documento — invalida a TABELA, nao o timeline. O
    // resultado era "Aceito por Fulano" exibido sobre dados de extracao NOVOS,
    // exatamente o que a invalidacao existe para impedir.
    mockQueries({
      comparison: {
        ...baseComparison,
        aggregateComparison: [
          {
            rowKey: 'aggregate:ports-match',
            label: 'Verificação de Portos',
            invoice: 'Santos',
            packingList: null,
            bl: 'Itajai',
            espelho: null,
            status: 'divergent',
          },
        ],
        // O aceite FOI invalidado: a lista de ativos volta vazia.
        acceptances: [],
      },
      // ...mas o evento continua no timeline, porque ele e append-only.
      events: [
        {
          id: 1,
          processId: 1,
          eventType: 'comparison_acceptance',
          title: 'Aceite',
          description: 'Divergencia validada com o despachante',
          metadata: { rowKey: 'aggregate:ports-match' },
          createdBy: 1,
          createdAt: '2026-06-19T12:00:00.000Z',
          userName: 'Eduarda',
        },
      ],
    });

    renderComparison();

    expect(await screen.findByText('Verificação de Portos')).toBeInTheDocument();
    expect(screen.queryByText('Aceito')).not.toBeInTheDocument();
    expect(screen.queryByText('Divergencia validada com o despachante')).not.toBeInTheDocument();
  });

  it('exposes the acceptance resolution note via a hover tooltip', () => {
    mockQueries({
      comparison: {
        ...baseComparison,
        aggregateComparison: [
          {
            rowKey: 'aggregate:ports-match',
            label: 'Verificação de Portos',
            invoice: 'Santos',
            packingList: null,
            bl: 'Itajai',
            espelho: null,
            status: 'divergent',
          },
        ],
        acceptances: [
          {
            id: 1,
            scope: 'aggregate',
            rowKey: 'aggregate:ports-match',
            fieldLabel: 'Verificação de Portos',
            itemCode: null,
            previousStatus: 'divergent',
            evidenceHash: 'abc',
            resolutionNote: 'Divergencia validada com o despachante',
            acceptedAt: '2026-06-19T12:00:00.000Z',
            acceptedBy: 1,
            acceptedByName: 'Eduarda',
          },
        ],
      },
      // O aceite vem do PAYLOAD da comparacao, nao mais do timeline. A tela
      // derivava de `process_events`, que a invalidacao por reprocessamento nao
      // toca — entao exibia "Aceito" sobre extracao nova. A fonte agora e
      // `comparison_acceptances`, que a invalidacao de fato limpa.
      events: [],
      report: { systemDataAvailable: false, crossDocumentChecks: [], systemChecks: [] },
    });

    renderComparison();

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent(/Divergencia validada com o despachante/i);
    // Accessible fallback: the same note is also exposed as a title attribute
    // on the acceptance container so it is reachable without JS hover.
    const titled = document.querySelector('div[title="Divergencia validada com o despachante"]');
    expect(titled).not.toBeNull();
    expect(within(titled as HTMLElement).getByText('Aceito')).toBeInTheDocument();
  });
});
