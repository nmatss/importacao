import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DollarSign, Trash2, Plus, TrendingUp, ArrowDownUp, Wallet, Calculator, X, Search, ChevronDown } from 'lucide-react';
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
    try {
      await api.delete(`/api/currency-exchange/${deleteId}`);
      queryClient.invalidateQueries({ queryKey: ['currency-exchange', selectedProcessId] });
      setDeleteId(null);
    } catch (err: any) {
      alert(err.message || 'Erro ao excluir cambio');
    }
  };

  const calculatedBrl =
    form.amountUsd && form.exchangeRate
      ? parseFloat(form.amountUsd) * parseFloat(form.exchangeRate)
      : 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const usd = parseFloat(form.amountUsd);
    const rate = parseFloat(form.exchangeRate);
    if (isNaN(usd) || isNaN(rate)) {
      alert('Valor USD e Taxa de Cambio devem ser numeros validos');
      return;
    }
    createMutation.mutate({
      processId: selectedProcessId,
      type: form.type,
      amountUsd: usd,
      exchangeRate: rate,
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

  const kpiCards = [
    {
      label: 'Total Balance USD',
      value: formatCurrency(totalBalanceUsd),
      icon: Wallet,
      gradient: 'from-blue-500 to-blue-600',
      bg: 'bg-blue-50',
    },
    {
      label: 'Total Deposit USD',
      value: formatCurrency(totalDepositUsd),
      icon: TrendingUp,
      gradient: 'from-emerald-500 to-emerald-600',
      bg: 'bg-emerald-50',
    },
    {
      label: 'Saldo USD',
      value: formatCurrency(saldoUsd),
      icon: ArrowDownUp,
      gradient: 'from-violet-500 to-violet-600',
      bg: 'bg-violet-50',
    },
    {
      label: 'Total BRL',
      value: formatCurrency(totalBrl, 'BRL'),
      icon: Calculator,
      gradient: 'from-amber-500 to-amber-600',
      bg: 'bg-amber-50',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-sm">
            <DollarSign className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Cambios</h2>
            <p className="text-sm text-slate-500">Gerenciamento de cambios por processo</p>
          </div>
        </div>
      </div>

      {/* Process Selector */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex-1 max-w-md">
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Processo</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <select
                value={selectedProcessId}
                onChange={(e) => setSelectedProcessId(e.target.value)}
                className="w-full appearance-none rounded-xl border border-slate-200 py-2.5 pl-10 pr-10 text-sm text-slate-900 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="">Selecione um processo</option>
                {processes?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.processCode} - {p.brand}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </div>
          </div>
          {selectedProcessId && (
            <button
              onClick={() => setShowForm(!showForm)}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:from-blue-700 hover:to-blue-800 hover:shadow-md"
            >
              <Plus className="h-4 w-4" />
              Novo Cambio
            </button>
          )}
        </div>
      </div>

      {loadingProcesses && <LoadingSpinner className="py-12" />}

      {/* New Exchange Form */}
      {selectedProcessId && showForm && (
        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
            <h3 className="text-base font-semibold text-slate-900">Novo Cambio</h3>
            <button
              onClick={() => { setShowForm(false); setForm(emptyForm); }}
              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="p-6">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Tipo</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as 'balance' | 'deposit' })}
                  className="w-full appearance-none rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-900 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="balance">Balance</option>
                  <option value="deposit">Deposit</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Valor USD</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.amountUsd}
                  onChange={(e) => setForm({ ...form, amountUsd: e.target.value })}
                  placeholder="0.00"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-900 transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  required
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Taxa de Cambio</label>
                <input
                  type="number"
                  step="0.0001"
                  value={form.exchangeRate}
                  onChange={(e) => setForm({ ...form, exchangeRate: e.target.value })}
                  placeholder="0.0000"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-900 transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  required
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Valor BRL (calculado)</label>
                <div className="flex h-[42px] items-center rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 text-sm font-medium text-slate-600">
                  {calculatedBrl ? formatCurrency(calculatedBrl, 'BRL') : <span className="text-slate-400">--</span>}
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Vencimento Pagamento</label>
                <input
                  type="date"
                  value={form.paymentDeadline}
                  onChange={(e) => setForm({ ...form, paymentDeadline: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-900 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  required
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Data de Expiracao</label>
                <input
                  type="date"
                  value={form.expirationDate}
                  onChange={(e) => setForm({ ...form, expirationDate: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-900 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  required
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Notas</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                  placeholder="Observacoes opcionais..."
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-900 transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-3 border-t border-slate-100 pt-5">
              <button
                type="button"
                onClick={() => { setShowForm(false); setForm(emptyForm); }}
                className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:from-blue-700 hover:to-blue-800 hover:shadow-md disabled:opacity-50"
              >
                {createMutation.isPending ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* KPI Cards */}
      {selectedProcessId && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {kpiCards.map((kpi) => (
              <div key={kpi.label} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-3.5">
                  <div className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${kpi.gradient} shadow-sm`}>
                    <kpi.icon className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-500">{kpi.label}</p>
                    <p className="text-lg font-bold text-slate-900">{kpi.value}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Table */}
          {loadingExchanges ? (
            <LoadingSpinner className="py-12" />
          ) : !exchanges?.length ? (
            <EmptyState
              icon={DollarSign}
              title="Nenhum cambio registrado"
              description="Adicione um novo cambio para este processo."
            />
          ) : (
            <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead>
                    <tr className="bg-slate-50/80">
                      <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Tipo</th>
                      <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Valor USD</th>
                      <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Taxa</th>
                      <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Valor BRL</th>
                      <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Vencimento</th>
                      <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Expiracao</th>
                      <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Notas</th>
                      <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Acoes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {exchanges.map((ex) => (
                      <tr key={ex.id} className="transition-colors hover:bg-slate-50">
                        <td className="whitespace-nowrap px-5 py-3.5">
                          <span
                            className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-semibold ${
                              ex.type === 'balance'
                                ? 'bg-blue-50 text-blue-700'
                                : 'bg-emerald-50 text-emerald-700'
                            }`}
                          >
                            {ex.type === 'balance' ? 'Balance' : 'Deposit'}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-5 py-3.5 text-sm font-medium text-slate-900">
                          {formatCurrency(ex.amountUsd)}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3.5 text-sm font-mono text-slate-700">
                          {Number(ex.exchangeRate).toFixed(4)}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3.5 text-sm font-medium text-slate-900">
                          {formatCurrency(ex.amountBrl, 'BRL')}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3.5 text-sm text-slate-500">
                          {formatDate(ex.paymentDeadline)}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3.5 text-sm text-slate-500">
                          {formatDate(ex.expirationDate)}
                        </td>
                        <td className="max-w-[200px] truncate px-5 py-3.5 text-sm text-slate-500">
                          {ex.notes || <span className="text-slate-300">--</span>}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3.5">
                          <button
                            onClick={() => setDeleteId(ex.id)}
                            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
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
