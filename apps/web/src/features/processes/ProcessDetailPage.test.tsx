import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportProcess } from '@/shared/types';
import { ProcessDetailPage } from './ProcessDetailPage';

const queryState = vi.hoisted(() => ({
  processLoading: false,
  cambiosLoading: false,
}));

const process = {
  id: 1,
  processCode: 'IMP-QA-001',
  brand: 'Puket',
  status: 'completed',
  logisticStatus: null,
  incoterm: null,
  portOfLoading: null,
  portOfDischarge: null,
  etd: null,
  eta: null,
  shipmentDate: null,
  etaActual: null,
  customsClearanceAt: null,
  cdArrivalAt: null,
  exporterName: null,
  exporterAddress: null,
  importerName: null,
  importerAddress: null,
  totalFobValue: null,
  freightValue: null,
  totalBoxes: null,
  totalNetWeight: null,
  totalGrossWeight: null,
  totalCbm: null,
  containerType: null,
  vesselName: null,
  blNumber: null,
  shippingLine: null,
  diNumber: null,
  customsChannel: null,
  freightAgent: null,
  inspectionType: null,
  hasLiItems: false,
  hasCertification: false,
  hasFreeOfCharge: false,
  correctionStatus: null,
  paymentTerms: null,
  aiExtractedData: null,
  notes: null,
  driveFolderId: null,
  sistemaDriveFolderId: null,
  createdAt: '2026-08-26T12:00:00.000Z',
  updatedAt: '2026-08-26T12:00:00.000Z',
  documents: [],
  followUp: null,
} satisfies ImportProcess;

const cambiosData = {
  exchanges: [
    {
      id: 1,
      type: 'balance' as const,
      amountUsd: '1000.00',
      exchangeRate: '5.20',
      amountBrl: '5200.00',
      paymentDeadline: null,
      expirationDate: null,
      notes: null,
      createdAt: '2026-08-26T12:00:00.000Z',
    },
  ],
  totals: {
    totalBalanceUsd: '1000.00',
    totalBalanceBrl: '5200.00',
    totalDepositUsd: '0',
    totalDepositBrl: '0',
  },
};

vi.mock('@/shared/hooks/useApi', () => ({
  useApiQuery: (key: readonly unknown[]) => {
    const refetch = vi.fn();
    if (key[0] === 'process') {
      return {
        data: queryState.processLoading ? undefined : process,
        isLoading: queryState.processLoading,
        error: null,
        refetch,
      };
    }
    if (key[0] === 'cambios') {
      return {
        data: queryState.cambiosLoading ? undefined : cambiosData,
        isLoading: queryState.cambiosLoading,
        error: null,
        refetch,
      };
    }
    if (key[0] === 'email-logs') {
      return { data: { data: [], pagination: {} }, isLoading: false, error: null, refetch };
    }
    return { data: [], isLoading: false, error: null, refetch };
  },
}));

vi.mock('./components/ProcessHeader', () => ({
  ProcessHeader: () => <div>Process header</div>,
}));
vi.mock('./components/ProcessTimeline', () => ({
  ProcessTimeline: () => <div>Process timeline</div>,
}));
vi.mock('./components/LogisticStatusBar', () => ({
  buildLogisticProps: () => ({ processId: 1 }),
  LogisticStatusBar: () => <div>Logistic status</div>,
}));
vi.mock('./components/ProcessInfoCard', () => ({
  ProcessInfoCard: () => <div>Process info</div>,
}));
vi.mock('./components/EspelhoTab', () => ({
  EspelhoTab: () => <div>Espelho content</div>,
}));
vi.mock('./components/CambiosTab', () => ({
  CambiosTab: () => <div>Cambios content</div>,
}));

function LocationProbe() {
  return <output data-testid="location-search">{useLocation().search}</output>;
}

function app(initialEntry: string) {
  return (
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationProbe />
      <Routes>
        <Route path="/importacao/processos/:id" element={<ProcessDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ProcessDetailPage conditional tab deep links', () => {
  beforeEach(() => {
    queryState.processLoading = false;
    queryState.cambiosLoading = false;
  });

  it('preserves the Espelho deep link while the process is loading', () => {
    queryState.processLoading = true;
    const view = render(app('/importacao/processos/1?tab=espelho'));

    expect(screen.getByTestId('location-search')).toHaveTextContent('?tab=espelho');

    queryState.processLoading = false;
    view.rerender(app('/importacao/processos/1?tab=espelho'));

    expect(screen.getByRole('tab', { name: 'Espelho' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Espelho content')).toBeInTheDocument();
  });

  it('preserves the Cambios deep link while the exchange summary is loading', () => {
    queryState.cambiosLoading = true;
    const view = render(app('/importacao/processos/1?tab=cambios'));

    expect(screen.getByTestId('location-search')).toHaveTextContent('?tab=cambios');

    queryState.cambiosLoading = false;
    view.rerender(app('/importacao/processos/1?tab=cambios'));

    expect(screen.getByRole('tab', { name: 'Câmbios' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Cambios content')).toBeInTheDocument();
  });
});
