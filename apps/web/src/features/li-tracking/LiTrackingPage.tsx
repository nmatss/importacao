import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileCheck,
  Search,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  CheckCircle2,
  Send,
  XCircle,
} from 'lucide-react';
import { useApiQuery } from '@/shared/hooks/useApi';
import { PageSkeleton } from '@/shared/components/Skeleton';
import { EmptyState } from '@/shared/components/EmptyState';
import { DateRangeFilter } from '@/shared/components/DateRangeFilter';
import { formatDate, cn } from '@/shared/lib/utils';

interface LiItem {
  id: number;
  processId: number | null;
  processCode: string;
  orgao: string | null;
  ncm: string | null;
  item: string | null;
  description: string | null;
  supplier: string | null;
  requestedByCompanyAt: string | null;
  submittedToFeniciaAt: string | null;
  deferredAt: string | null;
  expectedDeferralAt: string | null;
  averageDays: number | null;
  validUntil: string | null;
  lpcoNumber: string | null;
  etdOrigem: string | null;
  etaArmador: string | null;
  status: string;
  itemStatus: string | null;
  observations: string | null;
  brand?: string;
}

interface LiStats {
  byStatus: Record<string, number>;
  byOrgao: Record<string, number>;
}

const statusConfig: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  deferred: {
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    dot: 'bg-emerald-500',
    label: 'Deferida',
  },
  pending: { bg: 'bg-slate-100', text: 'text-slate-700', dot: 'bg-slate-400', label: 'Pendente' },
  submitted: { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500', label: 'Submetida' },
  expired: { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500', label: 'Vencida' },
  cancelled: { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500', label: 'Cancelada' },
};

const defaultStatus = {
  bg: 'bg-slate-100',
  text: 'text-slate-700',
  dot: 'bg-slate-400',
  label: '',
};

const kpiList = [
  { key: 'pending', label: 'Pendentes', icon: Clock, gradient: 'from-slate-500 to-slate-600' },
  { key: 'submitted', label: 'Submetidas', icon: Send, gradient: 'from-blue-500 to-blue-600' },
  {
    key: 'deferred',
    label: 'Deferidas',
    icon: CheckCircle2,
    gradient: 'from-emerald-500 to-emerald-600',
  },
  { key: 'expired', label: 'Vencidas', icon: XCircle, gradient: 'from-red-500 to-red-600' },
];

const ORGAO_OPTIONS = ['Inmetro', 'MAPA', 'Anvisa', 'DECEX', 'Ibama'];

const STATUS_OPTIONS = [
  { value: '', label: 'Todos os Status' },
  { value: 'pending', label: 'Pendente' },
  { value: 'submitted', label: 'Submetida' },
  { value: 'deferred', label: 'Deferida' },
  { value: 'expired', label: 'Vencida' },
  { value: 'cancelled', label: 'Cancelada' },
];

export function LiTrackingPage() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState('');
  const [orgaoFilter, setOrgaoFilter] = useState('');
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);
  const limit = 25;

  const queryParams = new URLSearchParams();
  queryParams.set('page', String(page));
  queryParams.set('limit', String(limit));
  if (statusFilter) queryParams.set('status', statusFilter);
  if (orgaoFilter) queryParams.set('orgao', orgaoFilter);
  if (search) queryParams.set('processCode', search);
  if (startDate) queryParams.set('startDate', startDate);
  if (endDate) queryParams.set('endDate', endDate);

  const { data: liResponse, isLoading } = useApiQuery<{
    data: LiItem[];
    pagination: { page: number; pages: number; total: number };
  }>(
    ['li-tracking', String(page), statusFilter, orgaoFilter, search, startDate, endDate],
    `/api/li-tracking?${queryParams.toString()}`,
  );
  const liData = liResponse?.data;
  const pagination = liResponse?.pagination;

  const { data: stats } = useApiQuery<LiStats>(['li-tracking-stats'], '/api/li-tracking/stats');

  if (isLoading) {
    return <PageSkeleton />;
  }

  function getStatusBadge(status: string) {
    const config = statusConfig[status] ?? defaultStatus;
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
          config.bg,
          config.text,
        )}
      >
        <span className={cn('h-1.5 w-1.5 rounded-full', config.dot)} />
        {config.label || status}
      </span>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-violet-600 shadow-sm">
          <FileCheck className="h-5 w-5 text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Licencas de Importacao (LI)</h2>
          <p className="text-sm text-slate-500">
            {pagination?.total ?? liData?.length ?? 0} licenca
            {(pagination?.total ?? liData?.length ?? 0) !== 1 ? 's' : ''} registrada
            {(pagination?.total ?? liData?.length ?? 0) !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpiList.map((kpi) => (
          <div
            key={kpi.key}
            className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm"
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
                <p className="text-lg font-bold text-slate-900">
                  {stats?.byStatus?.[kpi.key] ?? 0}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Filter Bar */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          {/* Search */}
          <div className="flex-1 max-w-xs">
            <label htmlFor="li-search" className="mb-1.5 block text-sm font-medium text-slate-700">
              Processo
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="li-search"
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Buscar processo..."
                className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-4 text-sm text-slate-900 transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>

          {/* Status Filter */}
          <div className="max-w-[200px]">
            <label htmlFor="li-status" className="mb-1.5 block text-sm font-medium text-slate-700">
              Status
            </label>
            <div className="relative">
              <select
                id="li-status"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full appearance-none rounded-xl border border-slate-200 py-2.5 pl-3.5 pr-10 text-sm text-slate-900 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </div>
          </div>

          {/* Orgao Filter */}
          <div className="max-w-[200px]">
            <label htmlFor="li-orgao" className="mb-1.5 block text-sm font-medium text-slate-700">
              Orgao
            </label>
            <div className="relative">
              <select
                id="li-orgao"
                value={orgaoFilter}
                onChange={(e) => {
                  setOrgaoFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full appearance-none rounded-xl border border-slate-200 py-2.5 pl-3.5 pr-10 text-sm text-slate-900 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="">Todos os Orgaos</option>
                {ORGAO_OPTIONS.map((org) => (
                  <option key={org} value={org}>
                    {org}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </div>
          </div>

          {/* Date Range Filter */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Periodo</label>
            <DateRangeFilter
              startDate={startDate}
              endDate={endDate}
              onStartDateChange={(v) => {
                setStartDate(v);
                setPage(1);
              }}
              onEndDateChange={(v) => {
                setEndDate(v);
                setPage(1);
              }}
              label=""
            />
          </div>
        </div>
      </div>

      {/* Table */}
      {!liData?.length ? (
        <EmptyState
          icon={FileCheck}
          title="Nenhuma LI encontrada"
          description="Nenhuma licenca de importacao encontrada com os filtros selecionados."
        />
      ) : (
        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead>
                <tr className="bg-slate-50/80">
                  <th className="px-3 py-2.5 sm:px-6 sm:py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Processo
                  </th>
                  <th className="px-3 py-2.5 sm:px-6 sm:py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Orgao
                  </th>
                  <th className="px-3 py-2.5 sm:px-6 sm:py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                    NCM
                  </th>
                  <th className="px-3 py-2.5 sm:px-6 sm:py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Status
                  </th>
                  <th className="px-3 py-2.5 sm:px-6 sm:py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Solicitacao
                  </th>
                  <th className="px-3 py-2.5 sm:px-6 sm:py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Deferimento
                  </th>
                  <th className="px-3 py-2.5 sm:px-6 sm:py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Validade
                  </th>
                  <th className="px-3 py-2.5 sm:px-6 sm:py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                    LPCO
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {liData.map((li) => (
                  <tr
                    key={li.id}
                    onClick={() =>
                      li.processId ? navigate(`/importacao/processos/${li.processId}`) : undefined
                    }
                    className={cn(
                      'transition-colors hover:bg-slate-50',
                      li.processId != null && 'cursor-pointer',
                    )}
                  >
                    <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5 text-sm font-semibold text-slate-900">
                      {li.processCode}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5 text-sm text-slate-600">
                      {li.orgao || <span className="text-slate-300">--</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5 text-sm font-mono text-slate-700">
                      {li.ncm || <span className="text-slate-300">--</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5">
                      {getStatusBadge(li.status)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5 text-sm text-slate-500">
                      {li.requestedByCompanyAt ? (
                        formatDate(li.requestedByCompanyAt)
                      ) : (
                        <span className="text-slate-300">--</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5 text-sm text-slate-500">
                      {li.deferredAt ? (
                        formatDate(li.deferredAt)
                      ) : li.expectedDeferralAt ? (
                        <span className="text-amber-600">
                          Prev. {formatDate(li.expectedDeferralAt)}
                        </span>
                      ) : (
                        <span className="text-slate-300">--</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5 text-sm text-slate-500">
                      {li.validUntil ? (
                        formatDate(li.validUntil)
                      ) : (
                        <span className="text-slate-300">--</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5 text-sm font-mono text-slate-700">
                      {li.lpcoNumber || <span className="text-slate-300">--</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination && pagination.pages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2.5 sm:px-6 sm:py-3.5">
              <p className="text-sm text-slate-500">
                Pagina {pagination.page} de {pagination.pages} ({pagination.total} registros)
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={pagination.page <= 1}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Anterior
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(pagination.pages, p + 1))}
                  disabled={pagination.page >= pagination.pages}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Proximo
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
