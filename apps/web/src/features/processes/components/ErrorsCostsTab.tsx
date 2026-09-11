import { useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, DollarSign, Plus, Trash2 } from 'lucide-react';
import { useApiQuery } from '@/shared/hooks/useApi';
import { api } from '@/shared/lib/api-client';
import { formatDateTime } from '@/shared/lib/utils';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import { ErrorState } from '@/shared/components/ErrorState';
import { getErrorMessage } from '@/shared/utils/errors';

interface OperationalRecord {
  id: number;
  recordKind: 'document_error' | 'extra_cost';
  recordType: string;
  quantity: number | null;
  amount: string | null;
  currency: string | null;
  notes: string | null;
  createdAt: string | null;
}

const kindLabel = {
  document_error: 'Erro documental',
  extra_cost: 'Custo extra',
};

// Espelha apps/api/src/modules/processes/constants.ts (EXTRA_COST_TYPES). A API
// canonicaliza a grafia, entao um valor digitado a mao continua valido — a
// lista existe para padronizar o que a operacao registra com mais frequencia.
const EXTRA_COST_TYPES = [
  'LAVAÇÃO',
  'REPARO',
  'LAVAÇÃO E REPARO',
  'LAVAGEM QUÍMICA',
  'REMOÇÃO DE DETRITOS',
];

export function ErrorsCostsTab({ processId }: { processId: string }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    recordKind: 'document_error' as OperationalRecord['recordKind'],
    recordType: '',
    quantity: '1',
    amount: '',
    currency: 'BRL',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const {
    data: records,
    isLoading,
    isError,
    refetch,
  } = useApiQuery<OperationalRecord[]>(
    ['process-operational-records', processId],
    `/api/processes/${processId}/operational-records`,
  );

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['process-operational-records', processId] });

  const saveRecord = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.recordType.trim()) return;
    setSaving(true);
    try {
      await api.post(`/api/processes/${processId}/operational-records`, {
        recordKind: form.recordKind,
        recordType: form.recordType,
        quantity: form.recordKind === 'document_error' ? Number(form.quantity) || 0 : null,
        amount: form.recordKind === 'extra_cost' && form.amount ? form.amount : undefined,
        currency: form.currency,
        notes: form.notes || null,
      });
      setForm({
        recordKind: 'document_error',
        recordType: '',
        quantity: '1',
        amount: '',
        currency: 'BRL',
        notes: '',
      });
      await refresh();
      toast.success('Registro salvo');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const deleteRecord = async (recordId: number) => {
    setDeletingId(recordId);
    try {
      await api.delete(`/api/processes/${processId}/operational-records/${recordId}`);
      await refresh();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setDeletingId(null);
    }
  };

  if (isLoading) return <LoadingSpinner className="py-8" />;
  if (isError) {
    return (
      <ErrorState message="Erro ao carregar erros e custos extras." onRetry={() => refetch()} />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
          Erros + Custos Extras
        </h3>
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
          {(records ?? []).length} registro(s)
        </span>
      </div>

      <form
        onSubmit={saveRecord}
        className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200/70 bg-white p-4 dark:border-slate-700/70 dark:bg-slate-800 lg:grid-cols-[160px_1fr_110px_140px_90px_auto]"
      >
        <select
          aria-label="Categoria do registro"
          value={form.recordKind}
          onChange={(event) =>
            setForm((prev) => ({
              ...prev,
              recordKind: event.target.value as OperationalRecord['recordKind'],
              // Os catalogos de erro e de custo nao se cruzam: manter o tipo
              // anterior gravaria "LAVAÇÃO" como erro documental.
              recordType: '',
            }))
          }
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
        >
          <option value="document_error">Erro documental</option>
          <option value="extra_cost">Custo extra</option>
        </select>
        <input
          aria-label="Tipo de erro ou custo"
          value={form.recordType}
          onChange={(event) => setForm((prev) => ({ ...prev, recordType: event.target.value }))}
          placeholder="Tipo"
          list={form.recordKind === 'extra_cost' ? 'extra-cost-types' : undefined}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
        />
        <datalist id="extra-cost-types">
          {EXTRA_COST_TYPES.map((type) => (
            <option key={type} value={type} />
          ))}
        </datalist>
        <input
          type="number"
          aria-label="Quantidade do erro documental"
          min={0}
          value={form.quantity}
          onChange={(event) => setForm((prev) => ({ ...prev, quantity: event.target.value }))}
          placeholder="Qtd"
          disabled={form.recordKind !== 'document_error'}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 disabled:bg-slate-50 disabled:text-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
        />
        <input
          aria-label="Valor do custo extra"
          value={form.amount}
          onChange={(event) => setForm((prev) => ({ ...prev, amount: event.target.value }))}
          placeholder="Valor"
          disabled={form.recordKind !== 'extra_cost'}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 disabled:bg-slate-50 disabled:text-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
        />
        <input
          aria-label="Moeda do custo extra"
          value={form.currency}
          onChange={(event) => setForm((prev) => ({ ...prev, currency: event.target.value }))}
          placeholder="Moeda"
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
        />
        <button
          type="submit"
          disabled={saving || !form.recordType.trim()}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {saving ? <LoadingSpinner size="sm" /> : <Plus className="h-4 w-4" />}
          Salvar
        </button>
        <textarea
          aria-label="Observação do registro"
          value={form.notes}
          onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
          placeholder="Observacao"
          className="lg:col-span-6 min-h-20 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
        />
      </form>

      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="min-w-[760px] w-full">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-900">
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Tipo
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Categoria
              </th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Quantidade
              </th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Valor
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Observacao
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Criado em
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Acao
              </th>
            </tr>
          </thead>
          <tbody>
            {(records ?? []).map((record) => (
              <tr key={record.id} className="border-t border-slate-100 dark:border-slate-700">
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                    {record.recordKind === 'document_error' ? (
                      <AlertTriangle className="h-3.5 w-3.5" />
                    ) : (
                      <DollarSign className="h-3.5 w-3.5" />
                    )}
                    {kindLabel[record.recordKind]}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm font-medium text-slate-800 dark:text-slate-100">
                  {record.recordType}
                </td>
                <td className="px-4 py-3 text-right font-mono text-sm text-slate-600 dark:text-slate-300">
                  {record.quantity ?? '--'}
                </td>
                <td className="px-4 py-3 text-right font-mono text-sm text-slate-600 dark:text-slate-300">
                  {record.amount ? `${record.currency ?? 'BRL'} ${record.amount}` : '--'}
                </td>
                <td className="min-w-[240px] px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
                  {record.notes ?? '--'}
                </td>
                <td className="min-w-[140px] px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                  {record.createdAt ? formatDateTime(record.createdAt) : '--'}
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => deleteRecord(record.id)}
                    disabled={deletingId === record.id}
                    className="rounded-lg p-2 text-slate-400 hover:bg-danger-50 hover:text-danger-600 disabled:opacity-50 dark:hover:bg-danger-950/30 dark:hover:text-danger-300"
                    aria-label={`Remover registro ${record.recordType}`}
                  >
                    {deletingId === record.id ? (
                      <LoadingSpinner size="sm" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </button>
                </td>
              </tr>
            ))}
            {(records ?? []).length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">
                  Nenhum erro ou custo extra registrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
