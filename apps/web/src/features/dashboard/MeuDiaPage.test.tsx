import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/shared/hooks/useApi', () => ({ useApiQuery: vi.fn() }));

import { useApiQuery } from '@/shared/hooks/useApi';
import { MeuDiaPage } from './MeuDiaPage';

/**
 * getSla (apps/api/src/modules/dashboard/service.ts) devolve exatamente estas
 * chaves — nao existe pendingCambio/pendingNumerario/pendingDesembaraco.
 */
const SLA_RESPONSE = {
  docsOverdue: [{ id: 1, processCode: 'IMP-1', brand: 'puket', daysSinceShipment: 12 }],
  liUrgent: [],
  withDivergences: [{ id: 2, processCode: 'IMP-2', brand: 'puket', failedCheckCount: 3 }],
  pendingFenicia: [],
  noEspelho: [],
  noFollowUpUpdate: [],
  agingByUser: [],
  upcomingPayments: [],
  summary: {},
};

function mockQueries(sla: Record<string, unknown>) {
  vi.mocked(useApiQuery).mockImplementation(((key: readonly unknown[]) => {
    if (key[0] === 'dashboard' && key[1] === 'sla') {
      return { data: sla, isLoading: false, error: null, refetch: vi.fn() };
    }
    if (key[0] === 'dashboard' && key[1] === 'overview') {
      return {
        data: {
          activeProcesses: 4,
          overdueProcesses: 1,
          completedThisMonth: 2,
          totalFobValue: 1000,
          recentAlerts: [],
        },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      };
    }
    return { data: { data: [] }, isLoading: false, error: null, refetch: vi.fn() };
  }) as unknown as typeof useApiQuery);
}

function renderPage() {
  return render(
    <MemoryRouter>
      <MeuDiaPage />
    </MemoryRouter>,
  );
}

describe('MeuDiaPage — Tarefas Pendentes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renderiza somente as tarefas que o contrato de /api/dashboard/sla cobre', () => {
    mockQueries(SLA_RESPONSE);
    renderPage();

    expect(screen.getByText('Documentos pendentes')).toBeInTheDocument();
    expect(screen.getByText('Divergências a resolver')).toBeInTheDocument();

    // Os tres cards abaixo foram removidos: o endpoint nunca devolveu esses
    // campos, entao `undefined?.length > 0` era sempre false e eles jamais
    // apareciam. Se voltarem, e porque o backend passou a agregar de verdade.
    expect(screen.queryByText('Cambio Pendente')).not.toBeInTheDocument();
    expect(screen.queryByText('Numerario Pendente')).not.toBeInTheDocument();
    expect(screen.queryByText('Desembaraco Pendente')).not.toBeInTheDocument();
  });

  it('ignora campos pendingCambio/Numerario/Desembaraco mesmo se o backend passar a envia-los', () => {
    mockQueries({
      ...SLA_RESPONSE,
      pendingCambio: [{ id: 3, processCode: 'IMP-3', brand: 'puket' }],
      pendingNumerario: [{ id: 4, processCode: 'IMP-4', brand: 'puket' }],
      pendingDesembaraco: [{ id: 5, processCode: 'IMP-5', brand: 'puket' }],
    });
    renderPage();

    expect(screen.queryByText('Cambio Pendente')).not.toBeInTheDocument();
    expect(screen.queryByText('Numerario Pendente')).not.toBeInTheDocument();
    expect(screen.queryByText('Desembaraco Pendente')).not.toBeInTheDocument();
  });

  it('aponta os links de status para a lista de processos', () => {
    mockQueries(SLA_RESPONSE);
    renderPage();

    expect(screen.getByText('Divergências a resolver').closest('a')).toHaveAttribute(
      'href',
      '/importacao/processos?status=validating',
    );
  });
});
