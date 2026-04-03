import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Anchor, Search, Package, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
import { useApiQuery } from '@/shared/hooks/useApi';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import { EmptyState } from '@/shared/components/EmptyState';
import { formatDate, cn } from '@/shared/lib/utils';

interface ProcessItem {
  id: number;
  processCode: string;
  status: string;
  aiExtractedData: Record<string, unknown> | null;
}

type ClearanceFilter = 'all' | 'pending' | 'cleared' | 'delivered';

const filterOptions: { value: ClearanceFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'pending', label: 'Pendente Desembaraco' },
  { value: 'cleared', label: 'Desembaracado' },
  { value: 'delivered', label: 'Entregue' },
];

const canalColors: Record<string, { bg: string; text: string }> = {
  Verde: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
  verde: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
  Amarelo: { bg: 'bg-amber-50', text: 'text-amber-700' },
  amarelo: { bg: 'bg-amber-50', text: 'text-amber-700' },
  Vermelho: { bg: 'bg-danger-50', text: 'text-danger-700' },
  vermelho: { bg: 'bg-danger-50', text: 'text-danger-700' },
};

function getField(data: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!data) return null;
  const val = data[key];
  if (val == null) return null;
  return String(val);
}

function matchesFilter(data: Record<string, unknown> | null, filter: ClearanceFilter): boolean {
  if (filter === 'all') return true;
  const desembaraco = getField(data, 'desembaraco');
  const chegadaCD = getField(data, 'chegadaCD');
  if (filter === 'delivered') return !!chegadaCD;
  if (filter === 'cleared') return !!desembaraco && !chegadaCD;
  // pending
  return !desembaraco;
}

export function DesembaracoPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<ClearanceFilter>('all');
  const [search, setSearch] = useState('');

  const { data: processResponse, isLoading } = useApiQuery<{
    data: ProcessItem[];
    pagination: unknown;
  }>(['processes-desembaraco'], '/api/processes?limit=100');
  const allProcesses = processResponse?.data;

  // Filter only processes that have aiExtractedData with customs-related fields
  const customsProcesses = useMemo(() => {
    if (!allProcesses) return [];
    return allProcesses.filter((p) => {
      const data = p.aiExtractedData;
      if (!data) return false;
      // Has at least one customs field
      return (
        data.numeroDI != null ||
        data.dataRegistroDI != null ||
        data.canal != null ||
        data.desembaraco != null ||
        data.recinto != null ||
        data.freeTime != null ||
        data.alertaDemurrage != null ||
        data.chegadaCD != null
      );
    });
  }, [allProcesses]);

  const filtered = useMemo(() => {
    let result = customsProcesses.filter((p) => matchesFilter(p.aiExtractedData, filter));
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((p) => p.processCode.toLowerCase().includes(q));
    }
    return result;
  }, [customsProcesses, filter, search]);

  // Stats
  const totalInClearance = customsProcesses.filter(
    (p) => !getField(p.aiExtractedData, 'desembaraco'),
  ).length;
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const clearedThisMonth = customsProcesses.filter((p) => {
    const d = getField(p.aiExtractedData, 'desembaraco');
    if (!d) return false;
    const date = new Date(d);
    return date.getMonth() === currentMonth && date.getFullYear() === currentYear;
  }).length;
  const freeTimeValues = customsProcesses
    .map((p) => {
      const ft = getField(p.aiExtractedData, 'freeTime');
      return ft ? parseFloat(ft) : NaN;
    })
    .filter((v) => !isNaN(v));
  const avgFreeTime =
    freeTimeValues.length > 0
      ? Math.round(freeTimeValues.reduce((a, b) => a + b, 0) / freeTimeValues.length)
      : 0;

  const kpiCards = [
    {
      label: 'Em Desembaraco',
      value: totalInClearance,
      icon: Clock,
      gradient: 'from-amber-500 to-amber-600',
    },
    {
      label: 'Desembaracados (Mes)',
      value: clearedThisMonth,
      icon: CheckCircle2,
      gradient: 'from-emerald-500 to-emerald-600',
    },
    {
      label: 'Free Time Medio (dias)',
      value: avgFreeTime,
      icon: AlertTriangle,
      gradient: 'from-primary-500 to-primary-600',
    },
  ];

  if (isLoading) {
    return <LoadingSpinner className="py-24" size="lg" />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-sky-600 shadow-sm">
          <Anchor className="h-5 w-5 text-white" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-900 tracking-tight">
            Desembaraco Aduaneiro
          </h2>
          <p className="text-sm text-slate-600">
            {customsProcesses.length} processo{customsProcesses.length !== 1 ? 's' : ''} com dados
            aduaneiros
          </p>
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

      {/* Filter Bar */}
      <div className="rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          {/* Search */}
          <div className="flex-1 max-w-xs">
            <label
              htmlFor="desembaraco-search"
              className="mb-1.5 block text-xs font-medium text-slate-500"
            >
              Processo
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="desembaraco-search"
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar processo..."
                className="w-full rounded-lg border border-slate-200 py-2 pl-10 pr-4 text-sm text-slate-700 transition-all placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              />
            </div>
          </div>

          {/* Status Filter Pills */}
          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-500">Status</p>
            <div className="flex items-center gap-1.5">
              {filterOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setFilter(opt.value)}
                  className={cn(
                    'rounded-lg px-3.5 py-1.5 text-sm font-medium transition-all',
                    filter === opt.value
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      {!filtered.length ? (
        <EmptyState
          icon={Package}
          title="Nenhum processo encontrado"
          description="Nenhum processo com dados de desembaraco encontrado com os filtros selecionados."
        />
      ) : (
        <div className="rounded-2xl border border-slate-200/60 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead>
                <tr className="bg-slate-50">
                  <th className="px-3 py-2.5 sm:px-6 sm:py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Processo
                  </th>
                  <th className="px-3 py-2.5 sm:px-6 sm:py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    DI
                  </th>
                  <th className="px-3 py-2.5 sm:px-6 sm:py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Data DI
                  </th>
                  <th className="px-3 py-2.5 sm:px-6 sm:py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Canal
                  </th>
                  <th className="px-3 py-2.5 sm:px-6 sm:py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Desembaraco
                  </th>
                  <th className="px-3 py-2.5 sm:px-6 sm:py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Recinto
                  </th>
                  <th className="px-3 py-2.5 sm:px-6 sm:py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Free Time
                  </th>
                  <th className="px-3 py-2.5 sm:px-6 sm:py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Demurrage
                  </th>
                  <th className="px-3 py-2.5 sm:px-6 sm:py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Chegada CD
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((proc) => {
                  const data = proc.aiExtractedData;
                  const canal = getField(data, 'canal');
                  const canalStyle = canal
                    ? (canalColors[canal] ?? { bg: 'bg-slate-100', text: 'text-slate-700' })
                    : null;
                  const demurrage = getField(data, 'alertaDemurrage');

                  return (
                    <tr
                      key={proc.id}
                      onClick={() => navigate(`/importacao/processos/${proc.id}`)}
                      className="cursor-pointer border-t border-slate-100 hover:bg-slate-50/50 transition-colors"
                    >
                      <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5 text-sm font-semibold text-slate-900">
                        {proc.processCode}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5 text-sm font-mono text-slate-700">
                        {getField(data, 'numeroDI') || <span className="text-slate-300">--</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5 text-sm text-slate-600">
                        {getField(data, 'dataRegistroDI') ? (
                          formatDate(getField(data, 'dataRegistroDI')!)
                        ) : (
                          <span className="text-slate-300">--</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5">
                        {canal && canalStyle ? (
                          <span
                            className={cn(
                              'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
                              canalStyle.bg,
                              canalStyle.text,
                            )}
                          >
                            {canal}
                          </span>
                        ) : (
                          <span className="text-sm text-slate-300">--</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5 text-sm text-slate-600">
                        {getField(data, 'desembaraco') ? (
                          formatDate(getField(data, 'desembaraco')!)
                        ) : (
                          <span className="text-slate-300">--</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5 text-sm text-slate-600">
                        {getField(data, 'recinto') || <span className="text-slate-300">--</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5 text-sm text-slate-600">
                        {getField(data, 'freeTime') ? (
                          `${getField(data, 'freeTime')} dias`
                        ) : (
                          <span className="text-slate-300">--</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5">
                        {demurrage ? (
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
                              demurrage.toLowerCase().includes('sim') ||
                                demurrage.toLowerCase().includes('yes')
                                ? 'bg-danger-50 text-danger-700'
                                : 'bg-emerald-50 text-emerald-700',
                            )}
                          >
                            {demurrage.toLowerCase().includes('sim') ||
                            demurrage.toLowerCase().includes('yes') ? (
                              <AlertTriangle className="h-3 w-3" />
                            ) : null}
                            {demurrage}
                          </span>
                        ) : (
                          <span className="text-sm text-slate-300">--</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5 text-sm text-slate-600">
                        {getField(data, 'chegadaCD') ? (
                          formatDate(getField(data, 'chegadaCD')!)
                        ) : (
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
