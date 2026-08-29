import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider, type UseMutationOptions } from '@tanstack/react-query';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const original = await importOriginal<typeof import('react-router-dom')>();
  return { ...original, useNavigate: () => mockNavigate };
});

vi.mock('@/shared/hooks/useApi', () => ({
  useApiQuery: vi.fn(),
  useApiMutation: vi.fn(),
}));

import { useApiQuery, useApiMutation } from '@/shared/hooks/useApi';
import { ProcessEditPage } from './ProcessEditPage';

const PROCESS_ID = '7';

/** Opcoes registradas pelo componente na mutacao — onde vive o onSuccess. */
let capturedOptions: UseMutationOptions<unknown, Error, unknown> | undefined;
const mutate = vi.fn();

function mockProcess(overrides: Record<string, unknown> = {}) {
  vi.mocked(useApiQuery).mockReturnValue({
    data: {
      id: 7,
      processCode: 'IMP-2026-007',
      brand: 'puket',
      incoterm: 'FOB',
      portOfLoading: 'Shanghai',
      portOfDischarge: 'Santos',
      etd: '2026-03-15',
      eta: '2026-04-20',
      exporterName: null,
      exporterAddress: null,
      importerName: null,
      importerAddress: null,
      notes: null,
      containerType: null,
      totalFobValue: null,
      freightValue: null,
      insuranceValue: null,
      customsValue: null,
      registrationDollar: null,
      totalCbm: null,
      totalBoxes: null,
      totalNetWeight: null,
      totalGrossWeight: null,
      shipmentDate: null,
      duimpNumber: null,
      registeredAt: null,
      customsClearanceAt: null,
      customsChannel: null,
      lockedAt: null,
      lockedReason: null,
      ...overrides,
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useApiQuery>);

  vi.mocked(useApiMutation).mockImplementation(((
    _url: string,
    _method: unknown,
    options: UseMutationOptions<unknown, Error, unknown>,
  ) => {
    capturedOptions = options;
    return { mutate, isPending: false, error: null };
  }) as unknown as typeof useApiMutation);
}

function renderPage(queryClient: QueryClient) {
  return render(
    <MemoryRouter initialEntries={[`/importacao/processos/${PROCESS_ID}/editar`]}>
      <QueryClientProvider client={queryClient}>
        <Routes>
          <Route path="/importacao/processos/:id/editar" element={<ProcessEditPage />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** Mesma tela, mas com FOB e caixas ja preenchidos para poder esvazia-los. */
function renderPageWithFilledNumbers(queryClient: QueryClient) {
  mockProcess({ totalFobValue: '1500.00', totalBoxes: 42 });
  return renderPage(queryClient);
}

describe('ProcessEditPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOptions = undefined;
    mockProcess();
  });

  it('invalida o processo e a lista ao salvar, antes de navegar', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    renderPage(queryClient);

    expect(capturedOptions?.onSuccess).toBeTypeOf('function');
    // Simula a resposta 200 do PUT.
    await capturedOptions?.onSuccess?.({}, {}, undefined, undefined as never);

    // Sem estas duas invalidacoes o detalhe volta a renderizar o dado
    // PRE-EDICAO por ate 30s (staleTime) logo depois do toast de sucesso.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['process', PROCESS_ID] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['processes'] });
    expect(mockNavigate).toHaveBeenCalledWith(`/importacao/processos/${PROCESS_ID}`);
  });

  /**
   * Contrato acertado com a API:
   *   chave AUSENTE      -> nao mexer no campo;
   *   chave com `null`   -> apagar o valor.
   */
  it('manda null SO para o campo que o usuario esvaziou', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderPage(queryClient);

    const portOfLoading = await screen.findByLabelText('Porto de Embarque');
    await user.clear(portOfLoading);

    await user.click(screen.getByRole('button', { name: /Salvar Alteracoes/i }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const payload = mutate.mock.calls[0][0] as Record<string, unknown>;

    // Estava preenchido e ficou vazio -> apagar.
    expect(payload).toHaveProperty('portOfLoading', null);

    // Campos com valor continuam indo normalmente.
    expect(payload.processCode).toBe('IMP-2026-007');
    expect(payload.portOfDischarge).toBe('Santos');
    expect(payload.etd).toBe('2026-03-15');
  });

  it('nao manda null para campo que ja estava vazio e o usuario nao tocou', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderPage(queryClient);

    // Mexe em UM campo so; todo o resto do processo veio nulo do backend.
    await user.clear(await screen.findByLabelText('Porto de Embarque'));
    await user.click(screen.getByRole('button', { name: /Salvar Alteracoes/i }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const payload = mutate.mock.calls[0][0] as Record<string, unknown>;

    // `reset()` preencheu estes com '' porque vieram null da API. Mandar null
    // neles apagaria dado que o usuario nem tocou — e sobrescreveria alteracao
    // feita por outra pessoa entre a carga da tela e o salvamento.
    for (const untouched of [
      'notes',
      'exporterName',
      'importerName',
      'duimpNumber',
      'customsChannel',
      'containerType',
      'totalFobValue',
      'totalBoxes',
      'shipmentDate',
    ]) {
      expect(untouched in payload).toBe(false);
    }

    // O unico null do payload e o campo realmente esvaziado.
    const nulled = Object.entries(payload)
      .filter(([, value]) => value === null)
      .map(([key]) => key);
    expect(nulled).toEqual(['portOfLoading']);
  });

  it('NAO apaga o incoterm, mesmo esvaziado — exclusao deliberada do allowlist', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderPage(queryClient);

    await user.clear(await screen.findByLabelText('Incoterm'));
    await user.click(screen.getByRole('button', { name: /Salvar Alteracoes/i }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const payload = mutate.mock.calls[0][0] as Record<string, unknown>;

    // O backend aceita null aqui, mas `incoterm` tem `default('FOB')` no schema
    // e esvaziar e ambiguo (NULL ou volta para FOB?). Ate a operacao decidir,
    // o campo e descartado e o valor anterior permanece.
    expect('incoterm' in payload).toBe(false);
  });

  it('nao manda null quando o usuario esvazia e digita o valor de volta', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderPage(queryClient);

    const portOfLoading = await screen.findByLabelText('Porto de Embarque');
    await user.clear(portOfLoading);
    await user.type(portOfLoading, 'Shanghai');

    await user.click(screen.getByRole('button', { name: /Salvar Alteracoes/i }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const payload = mutate.mock.calls[0][0] as Record<string, unknown>;

    expect(payload.portOfLoading).toBe('Shanghai');
    expect(Object.values(payload).some((value) => value === null)).toBe(false);
  });

  it('apaga tambem campos numericos e de data quando esvaziados', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderPageWithFilledNumbers(queryClient);

    await user.clear(await screen.findByLabelText('ETD'));
    await user.clear(screen.getByLabelText('Valor FOB USD'));
    await user.clear(screen.getByLabelText('Quantidade Caixas'));

    await user.click(screen.getByRole('button', { name: /Salvar Alteracoes/i }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const payload = mutate.mock.calls[0][0] as Record<string, unknown>;

    expect(payload).toHaveProperty('etd', null);
    expect(payload).toHaveProperty('totalFobValue', null);
    // `totalBoxes` e o caso perigoso: no backend `z.coerce.number()` viraria 0
    // se o null nao fosse curto-circuitado pelo `.nullable()`.
    expect(payload).toHaveProperty('totalBoxes', null);
  });
});
