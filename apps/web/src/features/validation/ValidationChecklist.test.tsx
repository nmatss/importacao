import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  checks: { id: number; checkName: string; status: 'passed' | 'failed' | 'warning' | 'skipped'; message?: string }[] | null = null,
) {
  vi.mocked(useApiQuery).mockReturnValue({
    data: checks,
    isLoading: false,
    refetch: mockRefetch,
    error: null,
    isError: false,
  } as ReturnType<typeof useApiQuery>);

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <MockAuthProvider>
          <ValidationChecklist processId={1} />
        </MockAuthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('ValidationChecklist', () => {
  it('renders without crashing when no data', () => {
    renderChecklist(null);
    expect(document.body).toBeTruthy();
  });

  it('renders without crashing with passed checks', () => {
    renderChecklist([
      { id: 1, checkName: 'check_invoice_number', status: 'passed' },
    ]);
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
});
