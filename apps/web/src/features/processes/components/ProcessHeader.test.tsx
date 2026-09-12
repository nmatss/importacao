import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MockAuthProvider } from '@/test/mocks/auth';
import type { ImportProcess } from '@/shared/types';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/shared/lib/api-client', () => ({
  api: { patch: vi.fn(), post: vi.fn(), get: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import { api } from '@/shared/lib/api-client';
import { ProcessHeader } from './ProcessHeader';

const baseProcess = {
  id: 1,
  processCode: 'PK2192607SZ',
  brand: 'puket',
  status: 'documents_received',
  logisticStatus: null,
  incoterm: null,
  portOfLoading: null,
  portOfDischarge: null,
  // Data de CALENDARIO: o cabecalho mostrava 06/08 com a invoice dizendo 07/08.
  etd: '2026-08-07',
  eta: '2026-09-08',
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
  hasLiItems: true,
  hasCertification: false,
  hasFreeOfCharge: true,
  correctionStatus: null,
  paymentTerms: null,
  aiExtractedData: null,
  notes: null,
  urgentNote: null,
  driveFolderId: 'pasta-drive',
  sistemaDriveFolderId: null,
  createdAt: '2026-08-26T12:00:00.000Z',
  updatedAt: '2026-08-26T12:00:00.000Z',
  documents: [],
  followUp: null,
} as unknown as ImportProcess;

function renderHeader(
  overrides: Partial<ImportProcess> = {},
  role: 'admin' | 'analyst' = 'analyst',
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MockAuthProvider
        value={{ user: { id: '1', name: 'Odett', email: 'odett@grupounico.com', role } }}
      >
        <ProcessHeader
          process={{ ...baseProcess, ...overrides } as ImportProcess}
          processId="1"
          onBack={vi.fn()}
          onEdit={vi.fn()}
        />
      </MockAuthProvider>
    </QueryClientProvider>,
  );
}

describe('ProcessHeader — barra fixa compacta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prioriza ETA realizado sem exibir a previsão como chegada real', () => {
    renderHeader({ eta: '2026-09-16', etaActual: '2026-09-08' });
    expect(screen.getByText(/ETA realizado/)).toBeInTheDocument();
    expect(screen.getByText('08/09/2026')).toBeInTheDocument();
    expect(screen.queryByText('16/09/2026')).not.toBeInTheDocument();
  });

  it('poe codigo, marca, status, datas, documentos e flags na MESMA faixa', () => {
    // A reuniao pediu "criado, ETD, ETA do lado da referencia; tudo pequeno e
    // numa linha". Antes eram 5 faixas empilhadas.
    renderHeader();
    const bar = screen.getByTestId('process-header-bar');

    expect(within(bar).getByText('PK2192607SZ')).toBeInTheDocument();
    expect(within(bar).getByText('puket')).toBeInTheDocument();
    expect(within(bar).getByText('Documentos Recebidos')).toBeInTheDocument();
    expect(within(bar).getByText(/Criado 26\/08\/2026/)).toBeInTheDocument();
    expect(within(bar).getByText(/0 docs \(0 extraidos\)/)).toBeInTheDocument();
    expect(within(bar).getByText('LI')).toBeInTheDocument();
    expect(within(bar).getByText('FOC')).toBeInTheDocument();
    expect(within(bar).getByLabelText('Observação urgente do processo')).toBeInTheDocument();
  });

  it('mostra ETD e ETA sem deslocar o dia', () => {
    // `2026-08-07` e data de calendario: passar por `new Date()` mostrava 06/08
    // no fuso de Brasilia (reuniao 11/09).
    renderHeader();
    const bar = screen.getByTestId('process-header-bar');

    expect(within(bar).getByText(/07\/08\/2026/)).toBeInTheDocument();
    expect(within(bar).getByText(/08\/09\/2026/)).toBeInTheDocument();
  });

  it('traduz o status de correcao em vez de mostrar a chave tecnica', () => {
    // O print da reuniao mostra `pending_correction` cru ao lado do codigo.
    renderHeader({ correctionStatus: 'pending_correction' });

    expect(screen.getByText('Aguardando correção')).toBeInTheDocument();
    expect(screen.queryByText('pending_correction')).not.toBeInTheDocument();
  });

  it('salva a observacao urgente inline, com Enter', async () => {
    const user = userEvent.setup();
    vi.mocked(api.put).mockResolvedValue({});
    renderHeader();

    const input = screen.getByLabelText('Observação urgente do processo');
    await user.type(input, 'precisamos diminuir essa telinha{Enter}');

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.put).mock.calls[0][0]).toBe('/api/processes/1');
    expect(vi.mocked(api.put).mock.calls[0][1]).toEqual({
      urgentNote: 'precisamos diminuir essa telinha',
    });
  });

  it('mantem os nomes acessiveis das acoes agora que sao so icone', () => {
    renderHeader({ lockedAt: '2026-09-10T12:00:00.000Z' } as Partial<ImportProcess>, 'admin');

    expect(screen.getByLabelText('Abrir no Drive')).toBeInTheDocument();
    expect(screen.getByLabelText('Editar')).toBeInTheDocument();
    expect(screen.getByLabelText('Destravar')).toBeInTheDocument();
    expect(screen.getByLabelText('Voltar para lista de processos')).toBeInTheDocument();
  });

  it('nao oferece Destravar para analista (a rota e admin-only)', () => {
    renderHeader({ lockedAt: '2026-09-10T12:00:00.000Z' } as Partial<ImportProcess>, 'analyst');

    expect(screen.queryByLabelText('Destravar')).not.toBeInTheDocument();
    expect(screen.getByText('Travado')).toBeInTheDocument();
  });
});
