import { useState } from 'react';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Circle,
  Clock,
  EyeOff,
  FileCheck,
  FolderOpen,
  ListPlus,
  Plus,
  Search,
  Ship,
  FileSpreadsheet,
  Send,
  PenTool,
  Mail,
  ClipboardList,
  FileText,
  ShieldCheck,
  Stamp,
  Trash2,
  X,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '@/shared/hooks/useApi';
import { api } from '@/shared/lib/api-client';
import { cn, formatDateTime } from '@/shared/lib/utils';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import { ErrorState } from '@/shared/components/ErrorState';
import { ConfirmDialog } from '@/shared/components/ConfirmDialog';
import { getErrorMessage } from '@/shared/utils/errors';

/**
 * Checklist do processo — fonte UNICA no servidor (decisao D7, reuniao 11/09).
 *
 * `GET /api/processes/:id/checklist` devolve o catalogo padrao e as etapas
 * especificas JA intercaladas na posicao escolhida, com o progresso calculado.
 * A tela nao tem mais lista propria de passos (era a causa de "Atualizar
 * Follow-up" virar "Enviado para Fenicia" no historico) e a aba "Etapas"
 * deixou de existir: adicionar na linha certa, excluir e ocultar acontecem
 * aqui dentro, que e o que a reuniao pediu ("em vez de ter essa aba de etapas,
 * dentro do checklist eu vou colocar um quadro para voce poder adicionar").
 */

interface ChecklistStepCommon {
  label: string;
  completedAt: string | null;
  completedByName: string | null;
}

interface ChecklistDefaultStep extends ChecklistStepCommon {
  kind: 'default';
  key: string;
  description: string;
}

interface ChecklistCustomStep extends ChecklistStepCommon {
  kind: 'custom';
  id: number;
  position: number;
  notes: string | null;
}

type ChecklistStep = ChecklistDefaultStep | ChecklistCustomStep;

interface ChecklistResponse {
  steps: ChecklistStep[];
  progress: { completed: number; total: number; pct: number };
}

interface DocumentChecklistTabProps {
  processId: string;
}

const STEP_ICONS: Record<string, React.ElementType> = {
  documentsReceivedAt: FileCheck,
  preInspectionAt: Search,
  savedToFolderAt: FolderOpen,
  ncmVerifiedAt: ClipboardList,
  ncmBlCheckedAt: Ship,
  freightBlCheckedAt: Ship,
  espelhoBuiltAt: FileSpreadsheet,
  invoiceSentFeniciaAt: Send,
  espelhoGeneratedAt: FileSpreadsheet,
  signaturesCollectedAt: PenTool,
  signedDocsSentAt: Mail,
  sentToFeniciaAt: FileText,
  diDraftAt: Stamp,
  liSubmittedAt: ShieldCheck,
  liApprovedAt: ShieldCheck,
};

function stepIcon(step: ChecklistStep): React.ElementType {
  if (step.kind === 'custom') return ListPlus;
  return STEP_ICONS[step.key] ?? Circle;
}

function stepId(step: ChecklistStep): string {
  return step.kind === 'custom' ? `custom:${step.id}` : `default:${step.key}`;
}

export function DocumentChecklistTab({ processId }: DocumentChecklistTabProps) {
  const queryClient = useQueryClient();
  const [busyStep, setBusyStep] = useState<string | null>(null);
  /** Linha (1-based) onde o formulario de nova etapa esta aberto. */
  const [insertAtLine, setInsertAtLine] = useState<number | null>(null);
  const [newStage, setNewStage] = useState({ label: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<
    | { kind: 'delete-custom'; id: number; label: string }
    | { kind: 'hide-default'; key: string; label: string }
    | null
  >(null);

  const {
    data: checklist,
    isLoading,
    isError,
    error,
    refetch,
  } = useApiQuery<ChecklistResponse>(
    ['process-checklist', processId],
    `/api/processes/${processId}/checklist`,
  );

  /**
   * Invalidacao em cascata: a aba Follow-Up, a ProcessTimeline (alimentada por
   * ['process', id]) e o SLA do dashboard leem o mesmo progresso. Sem isso
   * cada tela mostrava um numero diferente.
   */
  const refreshRelatedViews = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['process-checklist', processId] }),
      queryClient.invalidateQueries({ queryKey: ['follow-up', processId] }),
      queryClient.invalidateQueries({ queryKey: ['process', processId] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'sla'] }),
    ]);

  const toggleStep = async (step: ChecklistStep) => {
    setBusyStep(stepId(step));
    const completedAt = step.completedAt ? null : new Date().toISOString();
    try {
      if (step.kind === 'default') {
        // Via api-client: um 401 aqui precisa redirecionar para o login (a
        // logica de sessao expirada vive la) e a mensagem real do backend
        // precisa chegar ao operador.
        await api.patch(`/api/follow-up/${processId}/step`, { step: step.key, completedAt });
      } else {
        await api.put(`/api/processes/${processId}/custom-stages/${step.id}`, { completedAt });
      }
      await refreshRelatedViews();
      if (completedAt) toast.success(`${step.label} concluido`);
      else toast.info(`${step.label} desmarcado`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusyStep(null);
    }
  };

  const createStageAt = async (line: number) => {
    const label = newStage.label.trim();
    if (!label) return;
    setSaving(true);
    try {
      // `position` e a LINHA 1-based onde a etapa deve aparecer: "quero essa
      // etapa como terceira linha" vira position 3.
      await api.post(`/api/processes/${processId}/custom-stages`, {
        label,
        position: line,
        notes: newStage.notes.trim() || null,
      });
      setNewStage({ label: '', notes: '' });
      setInsertAtLine(null);
      await refreshRelatedViews();
      toast.success('Etapa adicionada');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const confirmPendingAction = async () => {
    if (!confirm) return;
    const pending = confirm;
    setConfirm(null);
    try {
      if (pending.kind === 'delete-custom') {
        await api.delete(`/api/processes/${processId}/custom-stages/${pending.id}`);
        toast.success('Etapa removida');
      } else {
        // Ocultar NAO apaga a coluna nem o timestamp: a etapa so sai da lista
        // e do denominador do progresso deste processo.
        await api.patch(`/api/processes/${processId}/checklist/steps/${pending.key}`, {
          hidden: true,
        });
        toast.success(`${pending.label} ocultada neste processo`);
      }
      await refreshRelatedViews();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    }
  };

  if (isLoading) {
    return <LoadingSpinner className="py-8" />;
  }

  if ((isError || error) && !checklist) {
    return (
      <ErrorState message="Erro ao carregar checklist documental." onRetry={() => refetch()} />
    );
  }

  const hasBackgroundError = Boolean((isError || error) && checklist);
  const steps = checklist?.steps ?? [];
  const progress = checklist?.progress ?? { completed: 0, total: steps.length, pct: 0 };

  /** Formulario inline de nova etapa, ancorado na linha onde foi aberto. */
  const insertForm = (line: number) => (
    <div className="rounded-lg border border-dashed border-primary-300 bg-primary-50/50 p-3 dark:border-primary-700 dark:bg-primary-950/20">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          autoFocus
          aria-label="Nome da nova etapa"
          value={newStage.label}
          onChange={(event) => setNewStage((prev) => ({ ...prev, label: event.target.value }))}
          placeholder="Nome da etapa"
          className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
        />
        <input
          aria-label="Observação da nova etapa"
          value={newStage.notes}
          onChange={(event) => setNewStage((prev) => ({ ...prev, notes: event.target.value }))}
          placeholder="Observacao (opcional)"
          className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => createStageAt(line)}
            disabled={saving || !newStage.label.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {saving ? <LoadingSpinner size="sm" /> : <ListPlus className="h-4 w-4" />}
            Adicionar
          </button>
          <button
            type="button"
            onClick={() => {
              setInsertAtLine(null);
              setNewStage({ label: '', notes: '' });
            }}
            aria-label="Cancelar nova etapa"
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 px-3 py-2 text-slate-500 hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  /** Separador clicavel entre linhas: "inserir etapa aqui". */
  const insertSlot = (line: number) =>
    insertAtLine === line ? (
      insertForm(line)
    ) : (
      <button
        type="button"
        onClick={() => {
          setInsertAtLine(line);
          setNewStage({ label: '', notes: '' });
        }}
        aria-label={`Inserir etapa na linha ${line}`}
        className="group/insert flex w-full items-center gap-2 rounded-md px-4 py-0.5 text-[11px] font-medium text-slate-300 transition-colors hover:bg-primary-50 hover:text-primary-600 dark:text-slate-600 dark:hover:bg-primary-950/30 dark:hover:text-primary-300"
      >
        <Plus className="h-3 w-3" />
        <span className="opacity-0 transition-opacity group-hover/insert:opacity-100 group-focus/insert:opacity-100">
          Inserir etapa aqui
        </span>
      </button>
    );

  return (
    <div className="space-y-4">
      {hasBackgroundError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-300">
          Falha ao atualizar o checklist. Exibindo a ultima leitura disponivel.
        </div>
      )}

      {/* Progresso: numero vindo do servidor, ja sem as etapas ocultas e
          contando as especificas deste processo. */}
      <div className="flex items-center gap-4 rounded-lg bg-slate-50 dark:bg-slate-900 px-4 py-3">
        <div className="flex-1">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Conferencia Documental
            </span>
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {progress.completed}/{progress.total} passos ({progress.pct}%)
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                progress.pct === 100
                  ? 'bg-emerald-500'
                  : progress.pct > 50
                    ? 'bg-primary-500'
                    : 'bg-amber-500',
              )}
              style={{ width: `${progress.pct}%` }}
            />
          </div>
        </div>
      </div>

      <div className="space-y-1">
        {steps.map((step, index) => {
          const isCompleted = !!step.completedAt;
          const isBusy = busyStep === stepId(step);
          const Icon = stepIcon(step);
          const timestamp = formatDateTime(step.completedAt);
          const detail = step.kind === 'custom' ? step.notes : step.description;

          return (
            <div key={stepId(step)}>
              {insertSlot(index + 1)}

              <div
                className={cn(
                  // `flex-wrap`: o carimbo "Concluido por ... em ..." e longo;
                  // em telas estreitas ele invadia o rotulo da etapa.
                  'group flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-4 py-3 text-left transition-all',
                  isCompleted
                    ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/30'
                    : 'border-slate-150 dark:border-slate-600 bg-white dark:bg-slate-900',
                  isBusy && 'opacity-60',
                )}
              >
                <button
                  type="button"
                  onClick={() => toggleStep(step)}
                  disabled={isBusy}
                  aria-label={
                    isCompleted ? `Reabrir etapa ${step.label}` : `Concluir etapa ${step.label}`
                  }
                  className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5 text-left"
                >
                  <span
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                      isCompleted
                        ? 'bg-emerald-500 text-white'
                        : 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400',
                    )}
                  >
                    {isCompleted ? <CheckCircle2 className="h-3.5 w-3.5" /> : String(index + 1)}
                  </span>

                  <Icon
                    className={cn(
                      'h-4 w-4 shrink-0',
                      isCompleted ? 'text-emerald-500' : 'text-slate-400',
                    )}
                  />

                  <span className="min-w-[9rem] flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          'text-sm font-medium',
                          isCompleted
                            ? 'text-emerald-700 dark:text-emerald-300'
                            : 'text-slate-700 dark:text-slate-300',
                        )}
                      >
                        {step.label}
                      </span>
                      {step.kind === 'custom' && (
                        <span className="rounded border border-primary-200 bg-primary-50 px-1.5 py-0.5 text-[10px] font-semibold text-primary-700 dark:border-primary-700 dark:bg-primary-950/30 dark:text-primary-300">
                          Etapa do processo
                        </span>
                      )}
                    </span>
                    {detail && (
                      <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                        {detail}
                      </span>
                    )}
                  </span>

                  <span className="ml-auto min-w-0 text-right sm:shrink-0">
                    {isBusy ? (
                      <LoadingSpinner size="sm" />
                    ) : isCompleted ? (
                      <span className="inline-flex items-start gap-1 text-left text-[11px] text-emerald-600 dark:text-emerald-300">
                        <Clock className="mt-0.5 h-3 w-3 shrink-0" />
                        {step.completedByName
                          ? `Concluido por ${step.completedByName} em ${timestamp}`
                          : timestamp}
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-300 group-hover:text-slate-400">
                        Clique para concluir
                      </span>
                    )}
                  </span>
                </button>

                {step.kind === 'custom' ? (
                  <button
                    type="button"
                    onClick={() =>
                      setConfirm({ kind: 'delete-custom', id: step.id, label: step.label })
                    }
                    aria-label={`Excluir etapa ${step.label}`}
                    title="Excluir etapa"
                    className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-danger-50 hover:text-danger-600 dark:hover:bg-danger-950/30 dark:hover:text-danger-300"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      setConfirm({ kind: 'hide-default', key: step.key, label: step.label })
                    }
                    aria-label={`Ocultar etapa ${step.label}`}
                    title="Ocultar etapa neste processo"
                    className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                  >
                    <EyeOff className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {/* Ultima posicao: inserir no fim da lista. */}
        {insertSlot(steps.length + 1)}
      </div>

      <ConfirmDialog
        isOpen={!!confirm}
        variant="danger"
        title={confirm?.kind === 'hide-default' ? 'Ocultar etapa' : 'Excluir etapa'}
        message={
          confirm?.kind === 'hide-default'
            ? `Ocultar "${confirm.label}" neste processo? A etapa sai da lista e do progresso; a data ja registrada continua guardada e a etapa segue valendo nos outros processos.`
            : `Excluir a etapa "${confirm?.label ?? ''}" deste processo? Esta ação não pode ser desfeita.`
        }
        confirmLabel={confirm?.kind === 'hide-default' ? 'Ocultar' : 'Excluir'}
        onConfirm={confirmPendingAction}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
