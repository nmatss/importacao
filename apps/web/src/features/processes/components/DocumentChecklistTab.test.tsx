import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
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

const PROCESS_ID = '7';

/** Chaves com que o componente registrou sua consulta. */
const observedKeys: unknown[][] = [];

/**
 * Resposta de `GET /api/processes/:id/checklist` — catalogo ATIVO ja
 * intercalado com a etapa especifica do processo na linha 3.
 */
const CHECKLIST = {
  steps: [
    {
      kind: 'default',
      key: 'documentsReceivedAt',
      label: 'Documentos Recebidos',
      description: 'Invoice, Packing List e BL recebidos',
      completedAt: '2026-09-08T15:30:00.000Z',
      completedByName: 'Odett Ferreira',
    },
    {
      kind: 'default',
      key: 'preInspectionAt',
      label: 'Pre-conferencia',
      description: 'Verificacao cruzada dos documentos',
      completedAt: null,
      completedByName: null,
    },
    {
      kind: 'custom',
      id: 91,
      label: 'Vistoria INMETRO',
      notes: 'Agendada com o OCP-0042',
      position: 3,
      completedAt: null,
      completedByName: null,
    },
    {
      kind: 'default',
      key: 'sentToFeniciaAt',
      label: 'Atualizar Follow-up',
      description: 'Planilha Follow-up atualizada',
      completedAt: null,
      completedByName: null,
    },
  ],
  progress: { completed: 1, total: 4, pct: 25 },
};

function mockChecklist(data: unknown = CHECKLIST) {
  observedKeys.length = 0;
  vi.mocked(useApiQuery).mockImplementation(((key: readonly unknown[]) => {
    observedKeys.push([...key]);
    return { data, isLoading: false, isError: false, error: null, refetch: vi.fn() };
  }) as unknown as typeof useApiQuery);
}

function renderChecklist() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
  render(
    <QueryClientProvider client={qc}>
      <DocumentChecklistTab processId={PROCESS_ID} />
    </QueryClientProvider>,
  );
  return { invalidateSpy };
}

describe('DocumentChecklistTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChecklist();
  });

  it('move a etapa existente por linha e atualiza as consultas relacionadas', async () => {
    const user = userEvent.setup();
    const { invalidateSpy } = renderChecklist();
    await user.click(screen.getByRole('button', { name: 'Mover Vistoria INMETRO para cima' }));
    expect(api.put).toHaveBeenCalledWith('/api/processes/7/custom-stages/91', { position: 2 });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['process-checklist', '7'] });
    expect(api.post).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('limita movimento nas extremidades', async () => {
    const user = userEvent.setup();
    mockChecklist({ ...CHECKLIST, steps: [CHECKLIST.steps[2]] });
    renderChecklist();
    expect(screen.getByRole('button', { name: /para cima/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /para baixo/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /para cima/ }));
    expect(api.put).not.toHaveBeenCalled();
  });

  it('falha ao mover preserva a lista e permite tentar novamente', async () => {
    const user = userEvent.setup();
    vi.mocked(api.put).mockRejectedValueOnce(new Error('Processo bloqueado'));
    const { invalidateSpy } = renderChecklist();
    await user.click(screen.getByRole('button', { name: 'Mover Vistoria INMETRO para cima' }));
    expect(screen.getAllByRole('button', { name: /^(Concluir|Reabrir) etapa/ })[2]).toHaveAttribute(
      'aria-label',
      'Concluir etapa Vistoria INMETRO',
    );
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Mover Vistoria INMETRO para cima' })).toBeEnabled();
  });

  it('le a lista pronta do servidor, com as etapas especificas na posicao escolhida', () => {
    renderChecklist();

    expect(observedKeys[0]).toEqual(['process-checklist', PROCESS_ID]);

    // A etapa especifica e a TERCEIRA linha, dentro do proprio checklist — a
    // aba "Etapas" separada deixou de existir (D7).
    const rowLabels = screen
      .getAllByRole('button', { name: /^(Concluir|Reabrir) etapa / })
      .map((button) => button.getAttribute('aria-label'));
    expect(rowLabels[2]).toBe('Concluir etapa Vistoria INMETRO');
    expect(screen.getByText('Etapa do processo')).toBeInTheDocument();

    // Progresso vem do servidor (ja sem as etapas ocultas/inativas).
    expect(screen.getByText('1/4 passos (25%)')).toBeInTheDocument();
    expect(screen.getByText(/Concluido por Odett Ferreira/)).toBeInTheDocument();
  });

  it('marcar etapa padrao usa o api-client e mantem Follow-Up, processo e SLA em dia', async () => {
    const user = userEvent.setup();
    vi.mocked(api.patch).mockResolvedValue({});
    const { invalidateSpy } = renderChecklist();

    await user.click(screen.getByRole('button', { name: 'Concluir etapa Pre-conferencia' }));

    // Pelo api-client: um 401 aqui precisa redirecionar para o login.
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.patch).mock.calls[0][0]).toBe(`/api/follow-up/${PROCESS_ID}/step`);
    expect(vi.mocked(api.patch).mock.calls[0][1]).toMatchObject({ step: 'preInspectionAt' });

    // A aba Follow-Up, a ProcessTimeline (['process', id]) e o SLA leem o mesmo
    // progresso: sem a invalidacao em cascata cada tela mostrava um numero.
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['follow-up', PROCESS_ID] });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['process-checklist', PROCESS_ID] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['process', PROCESS_ID] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['process-events', PROCESS_ID] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['dashboard', 'sla'] });
  });

  it('marcar etapa especifica atualiza a propria etapa, nao o follow-up', async () => {
    const user = userEvent.setup();
    vi.mocked(api.put).mockResolvedValue({});
    renderChecklist();

    await user.click(screen.getByRole('button', { name: 'Concluir etapa Vistoria INMETRO' }));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.put).mock.calls[0][0]).toBe(
      `/api/processes/${PROCESS_ID}/custom-stages/91`,
    );
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('insere uma etapa NA LINHA escolhida, sem sair da aba', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValue({});
    renderChecklist();

    await user.click(screen.getByRole('button', { name: 'Inserir etapa na linha 3' }));
    await user.type(screen.getByLabelText('Nome da nova etapa'), 'Conferir free time');
    await user.click(screen.getByRole('button', { name: 'Adicionar' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.post).mock.calls[0][0]).toBe(`/api/processes/${PROCESS_ID}/custom-stages`);
    expect(vi.mocked(api.post).mock.calls[0][1]).toMatchObject({
      label: 'Conferir free time',
      position: 3,
    });
  });

  it('exclui etapa especifica e oculta etapa padrao, cada uma pela sua rota', async () => {
    const user = userEvent.setup();
    vi.mocked(api.delete).mockResolvedValue({});
    vi.mocked(api.patch).mockResolvedValue({});
    renderChecklist();

    await user.click(screen.getByRole('button', { name: 'Excluir etapa Vistoria INMETRO' }));
    await user.click(screen.getByRole('button', { name: 'Excluir' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.delete).mock.calls[0][0]).toBe(
      `/api/processes/${PROCESS_ID}/custom-stages/91`,
    );

    await user.click(screen.getByRole('button', { name: 'Ocultar etapa Atualizar Follow-up' }));
    await user.click(screen.getByRole('button', { name: 'Ocultar' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.patch).mock.calls[0][0]).toBe(
      `/api/processes/${PROCESS_ID}/checklist/steps/sentToFeniciaAt`,
    );
    expect(vi.mocked(api.patch).mock.calls[0][1]).toMatchObject({ hidden: true });
  });

  it('mostra a mensagem real do backend quando a acao falha', async () => {
    const user = userEvent.setup();
    const { toast } = await import('sonner');
    vi.mocked(api.patch).mockRejectedValue(
      new Error('Processo travado em 2026-09-10. Destrave antes de alterar documentos.'),
    );
    renderChecklist();

    await user.click(screen.getByRole('button', { name: 'Concluir etapa Pre-conferencia' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Processo travado em 2026-09-10. Destrave antes de alterar documentos.',
      ),
    );
  });

  it('a web NAO pode voltar a declarar o catalogo de passos', () => {
    // Guarda estatica (D7): a lista voltar para a web e a regressao de origem —
    // dois catalogos, dois rotulos, "Atualizar Follow-up" virando "Enviado para
    // Fenicia" no historico.
    const constantsPath = path.resolve(import.meta.dirname, '../../../shared/lib/constants.ts');
    const source = readFileSync(constantsPath, 'utf8');
    expect(source).not.toMatch(/export const CHECKLIST_STEPS/);
    expect(source).not.toMatch(/signaturesCollectedAt/);
  });
});
