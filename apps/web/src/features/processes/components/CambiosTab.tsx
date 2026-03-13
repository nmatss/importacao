import { DollarSign } from 'lucide-react';
import { useApiQuery } from '@/shared/hooks/useApi';
import { cn, formatCurrency, formatDate } from '@/shared/lib/utils';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import type { CurrencyExchange, CurrencyTotals } from '@/shared/types';

export interface CambiosTabProps {
  processId: string;
}

export function CambiosTab({ processId }: CambiosTabProps) {
  const { data, isLoading } = useApiQuery<{ exchanges: CurrencyExchange[]; totals: CurrencyTotals }>(
    ['cambios', processId],
    `/api/currency-exchange/process/${processId}/totals`,
  );

  if (isLoading) return <LoadingSpinner className="py-8" />;

  const exchanges = data?.exchanges ?? [];
  const totals = data?.totals;

  const typeLabel = (t: string) => t === 'deposit' ? 'Deposito' : 'Saldo';
  const typeColor = (t: string) => t === 'deposit'
    ? 'bg-amber-100 text-amber-700'
    : 'bg-blue-100 text-blue-700';

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-slate-800">Cambios do Processo</h3>

      {/* Totals summary */}
      {totals && (Number(totals.totalBalanceUsd) > 0 || Number(totals.totalDepositUsd) > 0) && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4">
            <p className="text-xs font-semibold text-blue-500 uppercase tracking-wider">Saldo USD</p>
            <p className="mt-1 text-lg font-bold text-blue-800">{formatCurrency(totals.totalBalanceUsd)}</p>
          </div>
          <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4">
            <p className="text-xs font-semibold text-blue-500 uppercase tracking-wider">Saldo BRL</p>
            <p className="mt-1 text-lg font-bold text-blue-800">{formatCurrency(totals.totalBalanceBrl, 'BRL')}</p>
          </div>
          <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-4">
            <p className="text-xs font-semibold text-amber-500 uppercase tracking-wider">Deposito USD</p>
            <p className="mt-1 text-lg font-bold text-amber-800">{formatCurrency(totals.totalDepositUsd)}</p>
          </div>
          <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-4">
            <p className="text-xs font-semibold text-amber-500 uppercase tracking-wider">Deposito BRL</p>
            <p className="mt-1 text-lg font-bold text-amber-800">{formatCurrency(totals.totalDepositBrl, 'BRL')}</p>
          </div>
        </div>
      )}

      {exchanges.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
            <DollarSign className="h-6 w-6 text-slate-300" />
          </div>
          <p className="text-sm text-slate-400 font-medium">
            Nenhum cambio registrado para este processo.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200/80">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50/80">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Tipo</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Valor USD</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Taxa</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Valor BRL</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Vencimento</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Validade</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Obs.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {exchanges.map((ex) => (
                <tr key={ex.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-3">
                    <span className={cn('inline-flex rounded-lg px-2.5 py-0.5 text-xs font-semibold', typeColor(ex.type))}>
                      {typeLabel(ex.type)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-700">{formatCurrency(ex.amountUsd)}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-600">
                    {ex.exchangeRate ? Number(ex.exchangeRate).toFixed(4) : '\u2014'}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">
                    {ex.amountBrl ? formatCurrency(ex.amountBrl, 'BRL') : '\u2014'}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {ex.paymentDeadline ? formatDate(ex.paymentDeadline) : '\u2014'}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {ex.expirationDate ? formatDate(ex.expirationDate) : '\u2014'}
                  </td>
                  <td className="px-4 py-3 text-slate-500 max-w-[200px] truncate" title={ex.notes ?? ''}>
                    {ex.notes || '\u2014'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
