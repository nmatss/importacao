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

  it('shows a Sistema column with inline system values when system data is available', () => {
    mockQueries({
      comparison: {
        ...baseComparison,
        aggregateComparison: [
          {
            rowKey: 'aggregate:valor-invoice-vs-sistema',
            label: 'Valor Invoice vs Sistema',
            invoice: '$1.000,00',
            packingList: null,
            bl: null,
            espelho: null,
            status: 'divergent',
          },
        ],
      },
      report: {
        systemDataAvailable: true,
        crossDocumentChecks: [],
        systemChecks: [
          {
            id: 1,
            checkName: 'invoice-value-vs-fup',
            status: 'failed',
            expectedValue: '$1.200,00',
            actualValue: '$1.000,00',
          },
        ],
      },
    });

    renderComparison();

    expect(screen.getByRole('columnheader', { name: /^Sistema$/i })).toBeInTheDocument();
    // The system expected value is shown inline against the matching label.
    expect(screen.getByText('$1.200,00')).toBeInTheDocument();
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

  it('absorbs cross-document checks into the aggregate comparison', () => {
    mockQueries({
      comparison: { ...baseComparison, aggregateComparison: [] },
      report: {
        systemDataAvailable: false,
        systemChecks: [],
        crossDocumentChecks: [
          {
            id: 9,
            checkName: 'ports-match',
            status: 'failed',
            expectedValue: 'Santos',
            actualValue: 'Itajai',
            message: 'Portos divergentes',
          },
        ],
      },
    });

    renderComparison();

    expect(screen.getByText(/Verificação de Portos/i)).toBeInTheDocument();
    expect(screen.getByText(/Portos divergentes/i)).toBeInTheDocument();
    expect(screen.getByText(/cruzamento/i)).toBeInTheDocument();
    // The expected/actual values are presented with explicit
    // Esperado/Encontrado labels rather than reusing the Invoice/Espelho
    // document columns, so the header/value semantics match.
    expect(screen.getByText(/^Esperado$/i)).toBeInTheDocument();
    expect(screen.getByText(/^Encontrado$/i)).toBeInTheDocument();
    expect(screen.getByText('Santos')).toBeInTheDocument();
    expect(screen.getByText('Itajai')).toBeInTheDocument();
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
      },
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
