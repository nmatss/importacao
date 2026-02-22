import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DollarSign, Trash2, Plus, TrendingUp, ArrowDownUp, Wallet, Calculator } from 'lucide-react';
import { useApiQuery, useApiMutation } from '@/shared/hooks/useApi';
import { api } from '@/shared/lib/api-client';
import { formatCurrency, formatDate } from '@/shared/lib/utils';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import { EmptyState } from '@/shared/components/EmptyState';
import { ConfirmDialog } from '@/shared/components/ConfirmDialog';

interface Process {
  id: string;
  processCode: string;
  brand: string;
}

interface CurrencyExchange {
  id: string;
  processId: string;
  type: 'balance' | 'deposit';
  amountUsd: number;
  exchangeRate: number;
  amountBrl: number;
  paymentDeadline: string;
  expirationDate: string;
  notes: string | null;
  createdAt: string;
}

interface ExchangeForm {
  type: 'balance' | 'deposit';
  amountUsd: string;
  exchangeRate: string;
  paymentDeadline: string;
  expirationDate: string;
  notes: string;
}

const emptyForm: ExchangeForm = {
  type: 'balance',
  amountUsd: '',
  exchangeRate: '',
  paymentDeadline: '',
  expirationDate: '',
  notes: '',
};

export function CurrencyExchangePage() {
  const queryClient = useQueryClient();
  const [selectedProcessId, setSelectedProcessId] = useState('');
  const [form, setForm] = useState<ExchangeForm>(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: processResponse, isLoading: loadingProcesses } = useApiQuery<{ data: Process[]; pagination: unknown }>(
    ['processes'],
    '/api/processes',
  );
  const processes = processResponse?.data;

  const { data: exchanges, isLoading: loadingExchanges } = useApiQuery<CurrencyExchange[]>(
    ['currency-exchange', selectedProcessId],
    `/api/currency-exchange/process/${selectedProcessId}`,
    { enabled: !!selectedProcessId },
  );

  const createMutation = useApiMutation<CurrencyExchange, Omit<CurrencyExchange, 'id' | 'createdAt'>>(
    '/api/currency-exchange',
    'post',
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['currency-exchange', selectedProcessId] });
        setForm(emptyForm);
        setShowForm(false);
      },
    },
  );

  const handleDelete = async () => {
    if (!deleteId) return;
    await api.delete(`/api/currency-exchange/${deleteId}`);
    queryClient.invalidateQueries({ queryKey: ['currency-exchange', selectedProcessId] });
    setDeleteId(null);
  };

  const calculatedBrl =
    form.amountUsd && form.exchangeRate
      ? parseFloat(form.amountUsd) * parseFloat(form.exchangeRate)
      : 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      processId: selectedProcessId,
      type: form.type,
      amountUsd: parseFloat(form.amountUsd),
      exchangeRate: parseFloat(form.exchangeRate),
      amountBrl: calculatedBrl,
      paymentDeadline: form.paymentDeadline,
      expirationDate: form.expirationDate,
      notes: form.notes || null,
    });
  };

  const totalBalanceUsd = exchanges
    ?.filter((e) => e.type === 'balance')
    .reduce((sum, e) => sum + e.amountUsd, 0) ?? 0;

  const totalDepositUsd = exchanges
    ?.filter((e) => e.type === 'deposit')
    .reduce((sum, e) => sum + e.amountUsd, 0) ?? 0;

  const saldoUsd = totalBalanceUsd - totalDepositUsd;

  const totalBrl = exchanges?.reduce((sum, e) => sum + e.amountBrl, 0) ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Cambios</h2>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex-1 max-w-md">
          <label className="block text-sm font-medium text-gray-700 mb-1">Processo</label>
          <select
            value={selectedProcessId}
            onChange={(e) => setSelectedProcessId(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            <option value="">Selecione um processo</option>
            {processes?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.processCode} - {p.brand}
              </option>
            ))}
          </select>
        </div>
        {selectedProcessId && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            Novo Cambio
          </button>
        )}
      </div>

      {loadingProcesses && <LoadingSpinner className="py-12" />}

      {selectedProcessId && showForm && (
        <form onSubmit={handleSubmit} className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Novo Cambio</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as 'balance' | 'deposit' })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              >
                <option value="balance">Balance</option>
                <option value="deposit">Deposit</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Valor USD</label>
              <input
                type="number"
                step="0.01"
                value={form.amountUsd}
                onChange={(e) => setForm({ ...form, amountUsd: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Taxa de Cambio</label>
              <input
                type="number"
                step="0.0001"
                value={form.exchangeRate}
                onChange={(e) => setForm({ ...form, exchangeRate: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Valor BRL (calculado)</label>
              <input
                type="text"
                value={calculatedBrl ? formatCurrency(calculatedBrl, 'BRL') : ''}
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600"
                disabled
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Vencimento Pagamento</label>
              <input
                type="date"
                value={form.paymentDeadline}
                onChange={(e) => setForm({ ...form, paymentDeadline: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Data de Expiracao</label>
              <input
                type="date"
                value={form.expirationDate}
                onChange={(e) => setForm({ ...form, expirationDate: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                required
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">Notas</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => { setShowForm(false); setForm(emptyForm); }}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {createMutation.isPending ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      )}

      {selectedProcessId && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-blue-50 p-2">
                  <Wallet className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Total Balance USD</p>
                  <p className="text-lg font-semibold text-gray-900">{formatCurrency(totalBalanceUsd)}</p>
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-green-50 p-2">
                  <TrendingUp className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Total Deposit USD</p>
                  <p className="text-lg font-semibold text-gray-900">{formatCurrency(totalDepositUsd)}</p>
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-purple-50 p-2">
                  <ArrowDownUp className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Saldo USD</p>
                  <p className="text-lg font-semibold text-gray-900">{formatCurrency(saldoUsd)}</p>
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-amber-50 p-2">
                  <Calculator className="h-5 w-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Total BRL</p>
                  <p className="text-lg font-semibold text-gray-900">{formatCurrency(totalBrl, 'BRL')}</p>
                </div>
              </div>
            </div>
          </div>

          {loadingExchanges ? (
            <LoadingSpinner className="py-12" />
          ) : !exchanges?.length ? (
            <EmptyState
              icon={DollarSign}
              title="Nenhum cambio registrado"
              description="Adicione um novo cambio para este processo."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Tipo</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Valor USD</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Taxa</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Valor BRL</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Vencimento Pagamento</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Expiracao</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Notas</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Acoes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {exchanges.map((ex) => (
                    <tr key={ex.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            ex.type === 'balance'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-green-100 text-green-700'
                          }`}
                        >
                          {ex.type === 'balance' ? 'Balance' : 'Deposit'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">
                        {formatCurrency(ex.amountUsd)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">
                        {ex.exchangeRate.toFixed(4)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">
                        {formatCurrency(ex.amountBrl, 'BRL')}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                        {formatDate(ex.paymentDeadline)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                        {formatDate(ex.expirationDate)}
                      </td>
                      <td className="max-w-[200px] truncate px-4 py-3 text-sm text-gray-500">
                        {ex.notes || '-'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <button
                          onClick={() => setDeleteId(ex.id)}
                          className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                          title="Excluir"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {!selectedProcessId && !loadingProcesses && (
        <EmptyState
          icon={DollarSign}
          title="Selecione um processo"
          description="Escolha um processo no seletor acima para visualizar os cambios."
        />
      )}

      <ConfirmDialog
        isOpen={!!deleteId}
        title="Excluir Cambio"
        message="Tem certeza que deseja excluir este cambio? Esta acao nao pode ser desfeita."
        confirmLabel="Excluir"
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
