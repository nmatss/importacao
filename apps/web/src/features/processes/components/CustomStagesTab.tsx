import { useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle, ListPlus, Trash2 } from 'lucide-react';
import { useApiQuery } from '@/shared/hooks/useApi';
import { api } from '@/shared/lib/api-client';
import { cn, formatDateTime } from '@/shared/lib/utils';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import { ErrorState } from '@/shared/components/ErrorState';
import { getErrorMessage } from '@/shared/utils/errors';

interface CustomStage {
  id: number;
  processId: number;
  label: string;
  position: number;
  completedAt: string | null;
  notes: string | null;
  createdAt: string | null;
}

export function CustomStagesTab({ processId }: { processId: string }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ label: '', position: '0', notes: '' });
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  const {
    data: stages,
    isLoading,
    isError,
    refetch,
  } = useApiQuery<CustomStage[]>(
    ['process-custom-stages', processId],
    `/api/processes/${processId}/custom-stages`,
  );

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['process-custom-stages', processId] });

  const createStage = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.label.trim()) return;
    setSaving(true);
    try {
      await api.post(`/api/processes/${processId}/custom-stages`, {
        label: form.label,
        position: Number(form.position) || 0,
        notes: form.notes || null,
      });
      setForm({ label: '', position: '0', notes: '' });
      await refresh();
      toast.success('Etapa adicionada');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleStage = async (stage: CustomStage) => {
    setUpdatingId(stage.id);
    try {
      await api.put(`/api/processes/${processId}/custom-stages/${stage.id}`, {
        completedAt: stage.completedAt ? null : new Date().toISOString(),
      });
      await refresh();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setUpdatingId(null);
    }
  };

  const deleteStage = async (stageId: number) => {
    setUpdatingId(stageId);
    try {
      await api.delete(`/api/processes/${processId}/custom-stages/${stageId}`);
      await refresh();
      toast.success('Etapa removida');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setUpdatingId(null);
    }
  };

  if (isLoading) return <LoadingSpinner className="py-8" />;
  if (isError) {
    return (
      <ErrorState message="Erro ao carregar as etapas específicas." onRetry={() => refetch()} />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Etapas Especificas</h3>
        <span className="text-xs font-semibold text-slate-400">
          {(stages ?? []).length} etapa(s)
        </span>
      </div>

      <form
        onSubmit={createStage}
        className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200/70 bg-white p-4 dark:border-slate-700/70 dark:bg-slate-800 md:grid-cols-[1fr_120px_1fr_auto]"
      >
        <input
          aria-label="Nome da etapa"
          value={form.label}
          onChange={(event) => setForm((prev) => ({ ...prev, label: event.target.value }))}
          placeholder="Nome da etapa"
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
        />
        <input
          type="number"
          aria-label="Posição da etapa"
          min={0}
          value={form.position}
          onChange={(event) => setForm((prev) => ({ ...prev, position: event.target.value }))}
          placeholder="Posicao"
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
        />
        <input
          aria-label="Observação da etapa"
          value={form.notes}
          onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
          placeholder="Observacao"
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
        />
        <button
          type="submit"
          disabled={saving || !form.label.trim()}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {saving ? <LoadingSpinner size="sm" /> : <ListPlus className="h-4 w-4" />}
          Adicionar
        </button>
      </form>

      <div className="space-y-2">
        {(stages ?? []).map((stage) => (
          <div
            key={stage.id}
            className={cn(
              'flex flex-wrap items-center gap-3 rounded-xl border p-4',
              stage.completedAt
                ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/30'
                : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800',
            )}
          >
            <button
              type="button"
              onClick={() => toggleStage(stage)}
              disabled={updatingId === stage.id}
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-lg',
                stage.completedAt ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400',
              )}
            >
              {updatingId === stage.id ? (
                <LoadingSpinner size="sm" />
              ) : (
                <CheckCircle className="h-5 w-5" />
              )}
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-slate-400">#{stage.position}</span>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {stage.label}
                </p>
              </div>
              {stage.notes && <p className="mt-0.5 text-xs text-slate-500">{stage.notes}</p>}
              {stage.completedAt && (
                <p className="mt-0.5 text-xs font-medium text-emerald-700">
                  Concluida em {formatDateTime(stage.completedAt)}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => deleteStage(stage.id)}
              disabled={updatingId === stage.id}
              className="rounded-lg p-2 text-slate-400 hover:bg-danger-50 hover:text-danger-600"
              aria-label={`Remover etapa ${stage.label}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        {(stages ?? []).length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400 dark:border-slate-700">
            Nenhuma etapa especifica adicionada.
          </div>
        )}
      </div>
    </div>
  );
}
