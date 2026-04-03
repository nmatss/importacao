import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banknote, Search, DollarSign, Percent, Calculator } from 'lucide-react';
import { useApiQuery } from '@/shared/hooks/useApi';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import { EmptyState } from '@/shared/components/EmptyState';
import { formatDate, formatCurrency, cn } from '@/shared/lib/utils';

interface ProcessItem {
  id: number;
  processCode: string;
  totalFobValue: number | string | null;
  aiExtractedData: Record<string, unknown> | null;
}

function getField(data: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!data) return null;
  const val = data[key];
  if (val == null) return null;
  return String(val);
}

function getNumericField(
  data: Record<string, unknown> | null | undefined,
  key: string,
): number | null {
  if (!data) return null;
  const val = data[key];
  if (val == null) return null;
  const num = Number(val);
  return isNaN(num) ? null : num;
}

export function NumerarioPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  const { data: processResponse, isLoading } = useApiQuery<{
    data: ProcessItem[];
    pagination: unknown;
  }>(['processes-numerario'], '/api/processes?limit=100');
  const allProcesses = processResponse?.data;

  // Filter only processes that have numerario data
  const numerarioProcesses = useMemo(() => {
    if (!allProcesses) return [];
    return allProcesses.filter((p) => {
      const data = p.aiExtractedData;
      if (!data) return false;
      return (
        data.valorNumerario != null ||
        data.dataPgtoNumerario != null ||
        data.percentualNumerario != null
      );
    });
  }, [allProcesses]);

  const filtered = useMemo(() => {
    if (!search) return numerarioProcesses;
    const q = search.toLowerCase();
    return numerarioProcesses.filter((p) => p.processCode.toLowerCase().includes(q));
  }, [numerarioProcesses, search]);

  // Stats
  const totalNumerario = numerarioProcesses.reduce((sum, p) => {
    const val = getNumericField(p.aiExtractedData, 'valorNumerario');
    return sum + (val ?? 0);
  }, 0);

  const percentages = numerarioProcesses
    .map((p) => getNumericField(p.aiExtractedData, 'percentualNumerario'))
    .filter((v): v is number => v !== null);
  const avgPercentage =
    percentages.length > 0
      ? (percentages.reduce((a, b) => a + b, 0) / percentages.length).toFixed(1)
      : '0';

  const kpiCards = [
    {
      label: 'Total Numerario',
      value: formatCurrency(totalNumerario, 'BRL'),
      icon: DollarSign,
      gradient: 'from-emerald-500 to-emerald-600',
    },
    {
      label: 'Processos',
      value: numerarioProcesses.length,
      icon: Calculator,
      gradient: 'from-primary-500 to-primary-600',
    },
    {
      label: 'Percentual Medio',
      value: `${avgPercentage}%`,
      icon: Percent,
      gradient: 'from-violet-500 to-violet-600',
    },
  ];

  if (isLoading) {
    return <LoadingSpinner className="py-24" size="lg" />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 shadow-sm">
          <Banknote className="h-5 w-5 text-white" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-900 tracking-tight">Numerario</h2>
          <p className="text-sm text-slate-600">Depositos antecipados de numerario por processo</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {kpiCards.map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm"
          >
            <div className="flex items-center gap-3.5">
              <div
                className={cn(
                  'flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br shadow-sm',
                  kpi.gradient,
                )}
              >
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

      {/* Search */}
      <div className="rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm">
        <div className="max-w-xs">
          <label
            htmlFor="numerario-search"
            className="mb-1.5 block text-xs font-medium text-slate-500"
          >
            Processo
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              id="numerario-search"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar processo..."
              className="w-full rounded-lg border border-slate-200 py-2 pl-10 pr-4 text-sm text-slate-700 transition-all placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      {!filtered.length ? (
        <EmptyState
          icon={Banknote}
          title="Nenhum numerario encontrado"
          description="Nenhum processo com dados de numerario encontrado."
        />
      ) : (
        <div className="rounded-2xl border border-slate-200/60 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead>
                <tr className="bg-slate-50">
                  <th className="px-5 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Processo
                  </th>
                  <th className="px-5 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Valor FOB
                  </th>
                  <th className="px-5 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Valor Numerario
                  </th>
                  <th className="px-5 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    % Numerario
                  </th>
                  <th className="px-5 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Data Pagamento
                  </th>
                  <th className="px-5 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Solicitante
                  </th>
                  <th className="px-5 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Dados Cambio
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((proc) => {
                  const data = proc.aiExtractedData;
                  const valorNumerario = getNumericField(data, 'valorNumerario');
                  const percentual = getNumericField(data, 'percentualNumerario');
                  const fobValue = proc.totalFobValue ? Number(proc.totalFobValue) : null;

                  return (
                    <tr
                      key={proc.id}
                      onClick={() => navigate(`/importacao/processos/${proc.id}`)}
                      className="cursor-pointer border-t border-slate-100 hover:bg-slate-50/50 transition-colors"
                    >
                      <td className="whitespace-nowrap px-5 py-3.5 text-sm font-semibold text-slate-900">
                        {proc.processCode}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-sm font-medium text-slate-900">
                        {fobValue != null && !isNaN(fobValue) ? (
                          formatCurrency(fobValue)
                        ) : (
                          <span className="text-slate-300">--</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-sm font-medium text-slate-900">
                        {valorNumerario != null ? (
                          formatCurrency(valorNumerario, 'BRL')
                        ) : (
                          <span className="text-slate-300">--</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5">
                        {percentual != null ? (
                          <span
                            className={cn(
                              'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
                              percentual >= 100
                                ? 'bg-emerald-50 text-emerald-700'
                                : percentual >= 50
                                  ? 'bg-primary-50 text-primary-700'
                                  : 'bg-amber-50 text-amber-700',
                            )}
                          >
                            {percentual.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-sm text-slate-300">--</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-sm text-slate-600">
                        {getField(data, 'dataPgtoNumerario') ? (
                          formatDate(getField(data, 'dataPgtoNumerario')!)
                        ) : (
                          <span className="text-slate-300">--</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-sm text-slate-600">
                        {getField(data, 'solicitanteNumerario') || (
                          <span className="text-slate-300">--</span>
                        )}
                      </td>
                      <td className="max-w-[200px] truncate px-5 py-3.5 text-sm text-slate-600">
                        {getField(data, 'dadosCambio') || (
                          <span className="text-slate-300">--</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
