import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MockAuthProvider, mockUser } from '@/test/mocks/auth';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/shared/lib/api-client', () => ({
  api: { post: vi.fn() },
}));

const mockRefetch = vi.fn();

vi.mock('@/shared/hooks/useApi', () => ({
  useApiQuery: vi.fn(),
}));

import { useApiQuery } from '@/shared/hooks/useApi';
import { SydlePaymentsPage } from './SydlePaymentsPage';

const report = {
  data: [
    {
      id: 1,
      externalId: 'sydle-1',
      processId: null,
      matchStatus: 'unmatched',
      matchScore: null,
      matchReason: 'invoice,supplier,amount',
      processCode: 'IM001',
      purchaseRef: 'PO-1',
      purchaseOrder: null,
      proformaNumber: 'PI-1',
      invoiceNumber: 'INV-1',
      supplierName: 'Fornecedor',
      brand: 'puket',
      currency: 'USD',
      purchaseAmount: '100',
      paidAmount: '40',
      openAmount: '60',
      paymentType: 'deposit',
      paymentStatus: 'open',
      dueDate: '2026-06-10',
      paidAt: '2026-06-11',
      scheduledAt: null,
      exchangeRate: '5.4321',
      amountBrl: '543.21',
      bankName: 'Banco ABC',
      contractNumber: 'CON-1',
      remittanceId: 'REM-1',
      sourceUpdatedAt: '2026-06-11T12:00:00.000Z',
      syncedAt: '2026-06-10T12:00:00.000Z',
      portalProcessCode: null,
      portalBrand: null,
    },
  ],
  pagination: { total: 1, page: 1, limit: 50, pages: 1 },
};

const summary = {
  totalPurchaseUsd: 100,
  totalPaidUsd: 0,
  totalOpenUsd: 100,
  totalBrl: 0,
  records: 1,
  matched: 0,
  unmatched: 1,
  overdue: 0,
  dueSoon: 0,
  paid: 0,
  config: {
    enabled: true,
    configured: true,
    missing: [],
    paymentsPath: '/payments',
    pageSize: 50,
  },
  lastRun: {
    id: 7,
    status: 'skipped',
    trigger: 'cron',
    startedAt: '2026-06-10T12:00:00.000Z',
    completedAt: '2026-06-10T12:00:01.000Z',
    duration: 1,
    fetched: 0,
    created: 0,
    updated: 0,
    matched: 0,
    unmatched: 0,
    errors: 0,
    errorMessage: null,
    metadata: null,
  },
};

function renderPage(role: 'admin' | 'analyst' = 'admin') {
  vi.mocked(useApiQuery).mockImplementation((queryKey: readonly unknown[]) => {
    const key = Array.isArray(queryKey) ? queryKey[0] : null;
    return {
      data: key === 'sydle-payments' ? report : key === 'sydle-payments-summary' ? summary : [],
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
        <MockAuthProvider value={{ user: { ...mockUser, role } }}>
          <SydlePaymentsPage />
        </MockAuthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('SydlePaymentsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('formats date-only due dates without timezone shifting the day', () => {
    renderPage();

    expect(screen.getAllByText('10/06/2026').length).toBeGreaterThan(0);
  });

  it('shows SYDLE financial details that are available in the report payload', () => {
    renderPage();

    expect(screen.getAllByText('Banco ABC').length).toBeGreaterThan(0);
    expect(screen.getAllByText('CON-1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Remessa REM-1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('PTAX 5,4321').length).toBeGreaterThan(0);
    expect(screen.getAllByText('R$ 543,21').length).toBeGreaterThan(0);
    expect(screen.getAllByText('invoice,supplier,amount').length).toBeGreaterThan(0);
    expect(screen.getByText('Ignorada')).toBeInTheDocument();
  });

  it('blocks the report for analysts before enabling API queries', () => {
    renderPage('analyst');

    expect(screen.getByText('Relatorio SYDLE restrito a administradores.')).toBeInTheDocument();
    expect(vi.mocked(useApiQuery).mock.calls[0]?.[2]).toMatchObject({ enabled: false });
  });
});
