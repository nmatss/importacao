import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CurrencyExchange } from '@/shared/types';
import { CurrencyExchangePage } from './CurrencyExchangePage';

const state = vi.hoisted(() => ({ rows: [] as CurrencyExchange[], mutate: vi.fn() }));
vi.mock('@/shared/hooks/useApi', () => ({
  useAllPagesQuery: () => ({
    data: { data: [{ id: 1, processCode: 'IMP-TEST-001', brand: 'puket' }] },
    isLoading: false,
  }),
  useApiQuery: () => ({ data: state.rows, isLoading: false }),
  useApiMutation: () => ({ mutate: state.mutate, isPending: false, error: null }),
}));

function row(
  id: number,
  type: CurrencyExchange['type'],
  usd: string,
  brl: string | null,
): CurrencyExchange {
  return {
    id,
    type,
    amountUsd: usd,
    amountBrl: brl,
    exchangeRate: brl == null ? null : '5.2000',
    paymentDeadline: null,
    expirationDate: null,
    notes: null,
    createdAt: '2026-09-06T12:00:00Z',
  };
}

async function openPage() {
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CurrencyExchangePage />
    </QueryClientProvider>,
  );
  await user.selectOptions(screen.getByLabelText('Processo'), '1');
  return user;
}

beforeEach(() => {
  state.rows = [];
  vi.clearAllMocks();
});

describe('CurrencyExchangePage — contrato decimal da API', () => {
  it('soma varios decimais textuais e preserva centavos e BRL nulo', async () => {
    state.rows = [
      row(1, 'balance', '33775.10', null),
      row(2, 'balance', '3850.20', '20913.59'),
      row(3, 'deposit', '14475.00', '75472.65'),
      row(4, 'deposit', '375.05', '2021.25'),
    ];
    await openPage();
    expect(screen.getByText('Total Balance USD').parentElement).toHaveTextContent('US$ 37.625,30');
    expect(screen.getByText('Total Deposit USD').parentElement).toHaveTextContent('US$ 14.850,05');
    expect(screen.getByText('Saldo USD').parentElement).toHaveTextContent('US$ 22.775,25');
    expect(screen.getByText('Total BRL').parentElement).toHaveTextContent('R$ 98.407,49');
    expect(document.body).not.toHaveTextContent('NaN');
  });

  it('nao transforma taxa, BRL ou datas ausentes em zero ou janeiro de 1970', async () => {
    state.rows = [row(1, 'balance', '10.00', null)];
    await openPage();
    const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell');
    for (const index of [2, 3, 4, 5]) expect(cells[index]).toHaveTextContent('—');
    expect(document.body).not.toHaveTextContent(/1969|1970|Invalid Date/);
  });

  it('permite salvar sem observacao usando os tipos aceitos pela API', async () => {
    const user = await openPage();
    await user.click(screen.getByRole('button', { name: 'Novo Cambio' }));
    await user.type(screen.getByLabelText('Valor USD'), '100.25');
    await user.type(screen.getByLabelText('Taxa de Cambio'), '5.2');
    await user.type(screen.getByLabelText('Vencimento Pagamento'), '2026-09-10');
    await user.type(screen.getByLabelText('Data de Expiracao'), '2026-09-15');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(state.mutate).toHaveBeenCalledWith({
      processId: 1,
      type: 'balance',
      amountUsd: '100.25',
      exchangeRate: '5.2',
      amountBrl: '521.30',
      paymentDeadline: '2026-09-10',
      expirationDate: '2026-09-15',
      notes: '',
    });
  });
});
