import { beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MockAuthProvider } from '@/test/mocks/auth';

// Hoist mocks before any imports that use them
vi.mock('dompurify', () => ({ default: { sanitize: (html: string) => html } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/shared/lib/api-client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

const mockRefetch = vi.fn();
const mockMutate = vi.fn();

vi.mock('@/shared/hooks/useApi', () => ({
  useApiQuery: vi.fn(() => ({
    data: null,
    isLoading: false,
    refetch: mockRefetch,
    error: null,
    isError: false,
  })),
  useApiMutation: vi.fn(() => ({
    mutate: mockMutate,
    isPending: false,
  })),
}));

// Import after mocks are set up
import { ValidationChecklist } from './ValidationChecklist';
import { useApiQuery } from '@/shared/hooks/useApi';

function renderChecklist(
  checks:
    | {
        id: number;
        checkName: string;
        status: 'passed' | 'failed' | 'warning' | 'skipped';
        message?: string;
        resolvedManually?: boolean;
        resolvedBy?: string | number | null;
        resolvedAt?: string | null;
        expectedValue?: string;
        actualValue?: string;
      }[]
    | null = null,
) {
  vi.mocked(useApiQuery).mockImplementation((queryKey: unknown) => {
    const key = Array.isArray(queryKey) ? queryKey[0] : null;
    return {
      data: key === 'email-signatures' ? [] : checks,
      isLoading: false,
      refetch: mockRefetch,
      error: null,
      isError: false,
    } as unknown as ReturnType<typeof useApiQuery>;
  });

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <MockAuthProvider>
          <ValidationChecklist processId="1" />
        </MockAuthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('ValidationChecklist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing when no data', () => {
    renderChecklist(null);
    expect(document.body).toBeTruthy();
  });

  it('renders without crashing with passed checks', () => {
    renderChecklist([{ id: 1, checkName: 'check_invoice_number', status: 'passed' }]);
    expect(document.body).toBeTruthy();
  });

  it('renders without crashing with failed check', () => {
    renderChecklist([
      { id: 2, checkName: 'check_invoice_date', status: 'failed', message: 'Data inválida' },
    ]);
    expect(document.body).toBeTruthy();
  });

  it('renders without crashing with mixed statuses', () => {
    renderChecklist([
      { id: 1, checkName: 'check_invoice_number', status: 'passed' },
      { id: 2, checkName: 'check_invoice_date', status: 'failed', message: 'Data inválida' },
      { id: 3, checkName: 'check_weight', status: 'warning' },
      { id: 4, checkName: 'check_other', status: 'skipped' },
    ]);
    expect(document.body).toBeTruthy();
  });

  it('separates accepted failures from open failures and correction actions', () => {
    renderChecklist([
      { id: 1, checkName: 'ports-match', status: 'passed' },
      {
        id: 2,
        checkName: 'fob-calculation',
        status: 'failed',
        message: 'FOB aceito operacionalmente',
        resolvedManually: true,
        resolvedBy: 4,
        resolvedAt: '2026-06-08T15:41:00.000Z',
      },
    ]);

    expect(screen.getByRole('button', { name: /Falhas: 0/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Aceitos: 1/i })).toBeInTheDocument();
    expect(screen.getByText(/2 de 2 verificacoes aprovadas ou aceitas/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Gerar e-mail correcao/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Falhas: 0/i }));

    expect(screen.getByText(/Nenhuma falha aberta neste processo/i)).toBeInTheDocument();
  });

  it('shows correction actions only for unresolved failures', () => {
    renderChecklist([
      { id: 1, checkName: 'ports-match', status: 'passed' },
      {
        id: 2,
        checkName: 'fob-calculation',
        status: 'failed',
        message: 'FOB aceito operacionalmente',
        resolvedManually: true,
      },
      {
        id: 3,
        checkName: 'gross-weight-match',
        status: 'failed',
        message: 'Peso bruto divergente',
      },
    ]);

    expect(screen.getByRole('button', { name: /Falhas: 1/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Aceitos: 1/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Gerar e-mail correcao/i })).toBeInTheDocument();
  });
});
