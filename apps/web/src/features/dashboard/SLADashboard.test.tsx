import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/shared/hooks/useApi', () => ({ useApiQuery: vi.fn() }));

import { useApiQuery } from '@/shared/hooks/useApi';
import { SLADashboard } from './SLADashboard';

const EMPTY_SLA = {
  docsOverdue: [],
  liUrgent: [],
  withDivergences: [],
  pendingFenicia: [],
  noEspelho: [],
  noFollowUpUpdate: [],
  agingByUser: [],
  upcomingPayments: [],
  summary: {},
};

/** `amountUsd` chega como string porque a coluna e numeric no Postgres. */
const PAYMENTS = [
  {
    id: 1,
    processId: 11,
    processCode: 'IMP-MENOR',
    amountUsd: '9.00',
    paymentDeadline: '2026-04-10',
    daysUntilDue: 5,
  },
  {
    id: 2,
    processId: 22,
    processCode: 'IMP-MAIOR',
    amountUsd: '10000.00',
    paymentDeadline: '2026-04-12',
    daysUntilDue: 7,
  },
  {
    id: 3,
    processId: 33,
    processCode: 'IMP-MEIO',
    amountUsd: '100.00',
    paymentDeadline: '2026-04-11',
    daysUntilDue: 6,
  },
];

function mockSla() {
  vi.mocked(useApiQuery).mockReturnValue({
    data: { ...EMPTY_SLA, upcomingPayments: PAYMENTS },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useApiQuery>);
}

function processOrder() {
  const rows = screen.getAllByRole('link', { name: /Abrir processo/ });
  return rows.map((row) => within(row).getAllByRole('cell')[0].textContent);
}

describe('SLADashboard — ordenacao de Pagamentos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSla();
  });

  it('ordena "Valor USD" numericamente, nao por texto', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SLADashboard />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /Pagamentos/i }));
    await user.click(screen.getByRole('button', { name: /Valor USD/i }));

    // Lexicograficamente "10000.00" < "100.00" < "9.00" — era essa a ordem
    // errada que a tela mostrava.
    expect(processOrder()).toEqual(['IMP-MENOR', 'IMP-MEIO', 'IMP-MAIOR']);
  });

  it('inverte a ordem numerica no segundo clique', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SLADashboard />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /Pagamentos/i }));
    await user.click(screen.getByRole('button', { name: /Valor USD/i }));
    await user.click(screen.getByRole('button', { name: /Valor USD/i }));

    expect(processOrder()).toEqual(['IMP-MAIOR', 'IMP-MEIO', 'IMP-MENOR']);
  });

  it('mantem ordenacao textual para campos nao numericos', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SLADashboard />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /Pagamentos/i }));
    await user.click(screen.getByRole('button', { name: /^Processo/i }));

    expect(processOrder()).toEqual(['IMP-MAIOR', 'IMP-MEIO', 'IMP-MENOR']);
  });
});
