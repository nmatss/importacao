import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/shared/hooks/useApi', () => ({ useApiQuery: vi.fn() }));
vi.mock('@/shared/lib/api-client', () => ({
  api: { patch: vi.fn(), post: vi.fn(), get: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import { useApiQuery } from '@/shared/hooks/useApi';
import { api } from '@/shared/lib/api-client';
import { DocumentChecklistTab } from './DocumentChecklistTab';
import { FollowUpTab } from './FollowUpTab';

const PROCESS_ID = '7';

/** Chaves com que cada componente registrou sua consulta. */
const observedKeys: unknown[][] = [];

function mockFollowUp() {
  observedKeys.length = 0;
  vi.mocked(useApiQuery).mockImplementation(((key: readonly unknown[]) => {
    observedKeys.push([...key]);
    return {
      data: {
        id: 1,
        processId: 7,
        overallProgress: 0,
        documentsReceivedAt: null,
        stepCompletedBy: {},
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    };
  }) as unknown as typeof useApiQuery);
}

describe('DocumentChecklistTab <-> FollowUpTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFollowUp();
  });

  it('as duas abas usam a MESMA chave para /api/follow-up/:id', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <DocumentChecklistTab processId={PROCESS_ID} />
      </QueryClientProvider>,
    );
    const checklistKey = observedKeys[0];

    mockFollowUp();
    render(
      <QueryClientProvider client={qc}>
        <FollowUpTab processId={PROCESS_ID} />
      </QueryClientProvider>,
    );
    const followUpKey = observedKeys[0];

    // Eram ['follow-up', id] e ['followup', id] para o MESMO endpoint, entao
    // marcar um passo no checklist nao atualizava a aba Follow-Up.
    expect(checklistKey).toEqual(['follow-up', PROCESS_ID]);
    expect(followUpKey).toEqual(['follow-up', PROCESS_ID]);
  });

  it('marcar um passo usa o api-client e invalida follow-up, process e sla', async () => {
    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    vi.mocked(api.patch).mockResolvedValue({});

    render(
      <QueryClientProvider client={qc}>
        <DocumentChecklistTab processId={PROCESS_ID} />
      </QueryClientProvider>,
    );

    await user.click(screen.getAllByRole('button')[0]);

    // Pelo api-client: um 401 aqui precisa redirecionar para o login.
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.patch).mock.calls[0][0]).toBe(`/api/follow-up/${PROCESS_ID}/step`);

    // Invalidacao em cascata: so o refetch() local deixava a aba Follow-Up, a
    // ProcessTimeline (['process', id]) e o SLA exibindo o estado anterior.
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['follow-up', PROCESS_ID] });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['process', PROCESS_ID] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['dashboard', 'sla'] });
  });
});
