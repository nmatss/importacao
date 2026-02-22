import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { useApiQuery } from '@/shared/hooks/useApi';
import { formatCurrency, formatDate } from '@/shared/lib/utils';
import { PROCESS_STATUSES, BRANDS } from '@/shared/lib/constants';
import { StatusBadge } from '@/shared/components/StatusBadge';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import { EmptyState } from '@/shared/components/EmptyState';

interface Process {
  id: string;
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
  params.set('page', String(page));
  params.set('limit', String(limit));

  const { data, isLoading } = useApiQuery<ProcessListResponse>(
    ['processes', debouncedSearch, status, brand, String(page)],
    `/api/processes?${params.toString()}`,
  );

  const processes = data?.data ?? [];
  const totalPages = data?.pagination?.pages ?? 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Processos</h2>
        <Link
          to="/importacao/processos/novo"
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Novo Processo
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar por código..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">Todos os status</option>
          {PROCESS_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          value={brand}
          onChange={(e) => {
            setBrand(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">Todas as marcas</option>
          {BRANDS.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      {isLoading ? (
        <LoadingSpinner size="lg" className="py-24" />
      ) : processes.length === 0 ? (
        <EmptyState
          title="Nenhum processo encontrado"
          description="Tente ajustar os filtros ou crie um novo processo."
          action={{ label: 'Novo Processo', onClick: () => navigate('/importacao/processos/novo') }}
        />
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Código
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Marca
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Status
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    FOB Total
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    ETD
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Data Criação
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {processes.map((proc) => (
                  <tr
                    key={proc.id}
                    onClick={() => navigate(`/importacao/processos/${proc.id}`)}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <td className="px-5 py-3 text-sm font-medium text-blue-600">
                      {proc.processCode}
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-700 capitalize">
                      {proc.brand}
                    </td>
                    <td className="px-5 py-3 text-sm">
                      <StatusBadge status={proc.status} />
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-700">
                      {proc.totalFobValue != null
                        ? formatCurrency(proc.totalFobValue)
                        : '-'}
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-500">
                      {proc.etd ? formatDate(proc.etd) : '-'}
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-500">
                      {formatDate(proc.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-gray-200 px-5 py-3">
              <p className="text-sm text-gray-500">
                Página {page} de {totalPages} ({data?.pagination?.total ?? 0} resultados)
              </p>
              <div className="flex gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Anterior
                </button>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Próxima
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
