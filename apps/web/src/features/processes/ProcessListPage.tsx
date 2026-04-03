import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, ChevronLeft, ChevronRight, Package, Filter } from 'lucide-react';
import { useApiQuery } from '@/shared/hooks/useApi';
import { formatCurrency, formatDate } from '@/shared/lib/utils';
import { PROCESS_STATUSES, BRANDS } from '@/shared/lib/constants';
import { StatusBadge } from '@/shared/components/StatusBadge';
import { PageSkeleton } from '@/shared/components/Skeleton';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { DateRangeFilter } from '@/shared/components/DateRangeFilter';

interface Process {
  id: number;
  processCode: string;
  brand: string;
  status: string;
  totalFobValue: number | null;
  etd: string | null;
  createdAt: string;
}

interface ProcessListResponse {
  data: Process[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

export function ProcessListPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState('');
  const [brand, setBrand] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);
  const limit = 20;

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const params = new URLSearchParams();
  if (debouncedSearch) params.set('search', debouncedSearch);
  if (status) params.set('status', status);
  if (brand) params.set('brand', brand);
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);
  params.set('page', String(page));
  params.set('limit', String(limit));

  const { data, isLoading, error, refetch } = useApiQuery<ProcessListResponse>(
    ['processes', debouncedSearch, status, brand, startDate, endDate, String(page)],
    `/api/processes?${params.toString()}`,
  );

  const processes = data?.data ?? [];
  const totalPages = data?.pagination?.pages ?? 1;
  const totalResults = data?.pagination?.total ?? 0;

  const hasActiveFilters = debouncedSearch || status || brand || startDate || endDate;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 tracking-tight">Processos</h2>
          <p className="mt-1 text-sm text-slate-600">Gerencie seus processos de importacao</p>
        </div>
        <Link
          to="/importacao/processos/novo"
          className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 active:scale-[0.98] transition-colors"
        >
          <Plus className="h-4 w-4" />
          Novo Processo
        </Link>
      </div>

      {/* Filter Bar */}
      <div className="rounded-2xl border border-slate-200/60 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-0 w-full sm:min-w-[240px]">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por codigo do processo..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-slate-200 py-2 pl-10 pr-4 text-sm text-slate-700 placeholder:text-slate-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none transition-all"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-slate-400" />
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none transition-all"
              >
                <option value="">Todos os status</option>
                {PROCESS_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <select
              value={brand}
              onChange={(e) => {
                setBrand(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none transition-all"
            >
              <option value="">Todas as marcas</option>
              {BRANDS.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
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
            />
          </div>
          {hasActiveFilters && (
            <button
              onClick={() => {
                setSearch('');
                setStatus('');
                setBrand('');
                setStartDate('');
                setEndDate('');
                setPage(1);
              }}
              className="rounded-lg px-3 py-2 text-sm font-medium text-primary-600 hover:bg-primary-50 transition-colors"
            >
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      {error ? (
        <ErrorState message="Erro ao carregar processos." onRetry={() => refetch()} />
      ) : isLoading ? (
        <PageSkeleton />
      ) : processes.length === 0 ? (
        <div className="rounded-2xl border border-slate-200/60 bg-white shadow-sm">
          <EmptyState
            title="Nenhum processo encontrado"
            description={
              hasActiveFilters
                ? 'Tente ajustar os filtros para encontrar o que procura.'
                : 'Comece criando seu primeiro processo de importacao.'
            }
            action={{
              label: 'Novo Processo',
              onClick: () => navigate('/importacao/processos/novo'),
            }}
          />
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200/60 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200/60">
                  <th className="px-3 py-2.5 sm:px-5 sm:py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Codigo
                  </th>
                  <th className="px-3 py-2.5 sm:px-5 sm:py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Marca
                  </th>
                  <th className="px-3 py-2.5 sm:px-5 sm:py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Status
                  </th>
                  <th className="hidden md:table-cell px-3 py-2.5 sm:px-5 sm:py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    FOB Total
                  </th>
                  <th className="hidden lg:table-cell px-3 py-2.5 sm:px-5 sm:py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    ETD
                  </th>
                  <th className="hidden lg:table-cell px-3 py-2.5 sm:px-5 sm:py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Data Criacao
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {processes.map((proc) => (
                  <tr
                    key={proc.id}
                    onClick={() => navigate(`/importacao/processos/${proc.id}`)}
                    className="border-t border-slate-100 hover:bg-slate-50/50 cursor-pointer transition-colors group"
                  >
                    <td className="px-3 py-3 sm:px-5 sm:py-4 text-sm">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-50 text-primary-600 group-hover:bg-primary-100 transition-colors">
                          <Package className="h-4 w-4" />
                        </div>
                        <span className="font-semibold text-primary-600 group-hover:text-primary-700 transition-colors">
                          {proc.processCode}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3 sm:px-5 sm:py-4 text-sm text-slate-600 capitalize">
                      {proc.brand}
                    </td>
                    <td className="px-3 py-3 sm:px-5 sm:py-4 text-sm">
                      <StatusBadge status={proc.status} />
                    </td>
                    <td className="hidden md:table-cell px-3 py-3 sm:px-5 sm:py-4 text-sm text-slate-600">
                      {proc.totalFobValue != null ? (
                        formatCurrency(proc.totalFobValue)
                      ) : (
                        <span className="text-slate-300">--</span>
                      )}
                    </td>
                    <td className="hidden lg:table-cell px-3 py-3 sm:px-5 sm:py-4 text-sm text-slate-600">
                      {proc.etd ? formatDate(proc.etd) : <span className="text-slate-300">--</span>}
                    </td>
                    <td className="hidden lg:table-cell px-3 py-3 sm:px-5 sm:py-4 text-sm text-slate-600">
                      {formatDate(proc.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-t border-slate-200/60 px-5 py-4 bg-slate-50/40">
              <p className="text-sm text-slate-600">
                Mostrando pagina <span className="font-medium text-slate-700">{page}</span> de{' '}
                <span className="font-medium text-slate-700">{totalPages}</span>
                <span className="mx-1.5 text-slate-300">|</span>
                <span className="font-medium text-slate-700">{totalResults}</span> resultados
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Anterior
                </button>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                  Proxima
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
