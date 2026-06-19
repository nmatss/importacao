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
      matchReason: null,
      processCode: 'IM001',
      purchaseRef: 'PO-1',
      purchaseOrder: null,
      proformaNumber: 'PI-1',
      invoiceNumber: 'INV-1',
      supplierName: 'Fornecedor',
      brand: 'puket',
      currency: 'USD',
      purchaseAmount: '100',
      paidAmount: '0',
      openAmount: '100',
      paymentType: 'deposit',
      paymentStatus: 'open',
      dueDate: '2026-06-10',
      paidAt: null,
      scheduledAt: null,
      exchangeRate: null,
      amountBrl: null,
      bankName: null,
      contractNumber: null,
      remittanceId: null,
      sourceUpdatedAt: null,
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
  lastRun: null,
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

    expect(screen.getByText('10/06/2026')).toBeInTheDocument();
  });

  it('blocks the report for analysts before enabling API queries', () => {
    renderPage('analyst');

    expect(screen.getByText('Relatorio SYDLE restrito a administradores.')).toBeInTheDocument();
    expect(vi.mocked(useApiQuery).mock.calls[0]?.[2]).toMatchObject({ enabled: false });
  });
});
