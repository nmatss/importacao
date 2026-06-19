import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockRefetch = vi.fn();

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/shared/hooks/useApi', () => ({
  useApiQuery: vi.fn(),
}));

import { useApiQuery } from '@/shared/hooks/useApi';
import { ProformasTab } from './ProformasTab';

type ProformaOverrides = Partial<{
  documentId: number;
  filename: string;
  fileUrl: string | null;
  confidence: number | null;
  totalFobValue: number | null;
  currency: string | null;
  items: Array<Record<string, unknown>>;
  itemCount: number;
}>;

function makeProforma(overrides: ProformaOverrides = {}) {
  return {
    documentId: 10,
    filename: 'PI-123.pdf',
    fileUrl: '/api/documents/10/file',
    uploadedAt: null,
    confidence: 0.9,
    piNumber: 'PI-123',
    invoiceDate: '2026-01-10',
    validUntil: null,
    currency: 'USD',
    totalFobValue: 1500,
    paymentTerms: null,
    itemCount: overrides.items ? overrides.items.length : 0,
    items: [],
    preConsLinked: true,
    ...overrides,
  };
}

function mockAggregate(proformas: ReturnType<typeof makeProforma>[]) {
  vi.mocked(useApiQuery).mockReturnValue({
    data: {
      processId: 1,
      proformaCount: proformas.length,
      totals: {
        itemCount: proformas.reduce((a, p) => a + p.itemCount, 0),
        totalFobValue: proformas.reduce((a, p) => a + (p.totalFobValue ?? 0), 0),
      },
      proformas,
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: mockRefetch,
  } as unknown as ReturnType<typeof useApiQuery>);
}

describe('ProformasTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('importacao_token', 'token-123');
  });

  it('shows an error state instead of the empty state when the aggregate query fails', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('boom'),
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useApiQuery>);

    render(<ProformasTab processId="1" />);

    expect(screen.getByRole('alert')).toHaveTextContent(/Erro ao carregar proformas/i);
    expect(screen.queryByText(/Nenhuma Proforma Invoice anexada/i)).not.toBeInTheDocument();
  });

  it('renders FOB total and item rows when extraction returned items', () => {
    mockAggregate([
      makeProforma({
        items: [
          { itemCode: 'A1', description: 'Caneca', ncmCode: '6912', quantity: 100, unitPrice: 2, totalPrice: 200 },
        ],
        itemCount: 1,
        totalFobValue: 200,
      }),
    ]);

    render(<ProformasTab processId="1" />);

    expect(screen.getByText(/FOB USD 200\.00/)).toBeInTheDocument();
    expect(screen.getByText('Caneca')).toBeInTheDocument();
    expect(screen.getByText('A1')).toBeInTheDocument();
  });

  it('renders a download button that fetches the proforma file with auth', async () => {
    mockAggregate([makeProforma({ fileUrl: '/api/documents/10/file' })]);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      redirected: false,
      blob: vi.fn().mockResolvedValue(new Blob(['x'])),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });

    render(<ProformasTab processId="1" />);

    fireEvent.click(screen.getByRole('button', { name: /Baixar/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/documents/10/file?download=1',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
        }),
      ),
    );
  });

  it('shows a low-confidence empty state when extraction returned no items', () => {
    mockAggregate([makeProforma({ items: [], itemCount: 0, confidence: 0.3 })]);

    render(<ProformasTab processId="1" />);

    expect(screen.getByText(/baixa confianca/i)).toBeInTheDocument();
  });

  it('shows a generic empty state when items are missing but confidence is acceptable', () => {
    mockAggregate([makeProforma({ items: [], itemCount: 0, confidence: 0.9 })]);

    render(<ProformasTab processId="1" />);

    expect(screen.getByText(/Itens nao extraidos desta Proforma/i)).toBeInTheDocument();
  });

  it('does not crash and shows the empty state when a proforma has undefined items', () => {
    // A Proforma still being extracted (or a partial/stale read) can arrive
    // with items undefined. The render-time guard must treat it as empty
    // instead of crashing on pi.items.length / pi.items.map.
    const proforma = makeProforma({ confidence: 0.9 });
    // Force the unguarded shape the backend can emit before extraction lands.
    delete (proforma as { items?: unknown }).items;
    mockAggregate([proforma]);

    expect(() => render(<ProformasTab processId="1" />)).not.toThrow();

    expect(screen.getByText(/Itens nao extraidos desta Proforma/i)).toBeInTheDocument();
  });
});
