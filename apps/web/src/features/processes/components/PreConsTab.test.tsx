import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/shared/hooks/useApi', () => ({ useApiQuery: vi.fn() }));

import { useApiQuery } from '@/shared/hooks/useApi';
import { PreConsTab } from './PreConsTab';

const PROCESS_CODE = 'IMP-2026-007';

const ITEMS = [
  {
    id: 1,
    processCode: PROCESS_CODE,
    productName: 'Meia Puket',
    itemCode: 'SKU-1',
    quantity: 10,
    agreedPrice: '2.50',
    ncmCode: '6115',
    amount: '25.00',
    cbm: '0.100',
    etd: '2026-03-15',
    eta: '2026-04-20',
    cargoReadyDate: null,
    piNumber: 'PI-1',
    ean13: null,
    color: null,
    collection: null,
    portOfLoading: null,
    supplier: null,
    sheetName: 'Aba1',
  },
];

/** `divergences` e a segunda query do componente. */
function mockQueries(divergences: { data?: unknown; error?: unknown }) {
  vi.mocked(useApiQuery).mockImplementation(((key: readonly unknown[]) => {
    if (key[0] === 'pre-cons-process') {
      return { data: ITEMS, isLoading: false, isError: false, error: null, refetch: vi.fn() };
    }
    return {
      data: divergences.data,
      isLoading: false,
      isError: Boolean(divergences.error),
      error: divergences.error ?? null,
      refetch: vi.fn(),
    };
  }) as unknown as typeof useApiQuery);
}

function renderTab() {
  return render(<PreConsTab processId="7" processCode={PROCESS_CODE} />);
}

describe('PreConsTab — badge de divergencias', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mostra "Sem divergencias" quando a consulta funcionou e voltou vazia', () => {
    mockQueries({ data: [] });
    renderTab();
    expect(screen.getByText('Sem divergencias')).toBeInTheDocument();
  });

  it('nao afirma "Sem divergencias" quando falta permissao (403)', () => {
    // /api/pre-cons/divergences e admin-only: para um usuario comum a resposta
    // e 403, `allDivergences` fica undefined e o badge VERDE aparecia —
    // ausencia de autorizacao apresentada como ausencia de problema.
    mockQueries({ error: new Error('Acesso restrito a administradores') });
    renderTab();

    expect(screen.queryByText('Sem divergencias')).not.toBeInTheDocument();
    expect(screen.getByText(/Divergencias nao verificadas/)).toBeInTheDocument();
    expect(screen.getByText(/sem permissao/)).toBeInTheDocument();
  });

  it('usa estado neutro, sem citar permissao, quando o erro nao e de autorizacao', () => {
    mockQueries({ error: new Error('Network request failed') });
    renderTab();

    expect(screen.queryByText('Sem divergencias')).not.toBeInTheDocument();
    expect(screen.getByText(/Divergencias nao verificadas/)).toBeInTheDocument();
    expect(screen.queryByText(/sem permissao/)).not.toBeInTheDocument();
  });

  it('mostra a contagem quando ha divergencias', () => {
    mockQueries({
      data: [
        {
          processCode: PROCESS_CODE,
          field: 'totalFobValue',
          preConsValue: '100',
          systemValue: '120',
          severity: 'critical',
        },
      ],
    });
    renderTab();
    expect(screen.getByText('1 divergencia')).toBeInTheDocument();
  });
});
