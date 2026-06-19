import { useEffect, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CertStatusBadge } from '@/features/certificacoes/components/CertStatusBadge';
import { fetchCertProducts, verifyCertProduct } from '@/shared/lib/cert-api-client';
import { DateRangeFilter } from '@/shared/components/DateRangeFilter';
import { cn, formatDateTime } from '@/shared/lib/utils';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Package,
  RefreshCw,
  ExternalLink,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { CertProduct } from '@/shared/lib/cert-api-client';

// ── Filter config ──────────────────────────────────────────────────────
// Filtros sobre as colunas semânticas reais. Cada eixo é independente:
//   - cert_status:    ATIVO | ENCERRADO          (Status Certificacao)
//   - site_status:    CONFORME | NAO_CONFORME    (Status Ecommerce)
//   - license_status: VALIDO | VENCIDO | NAO_APLICAVEL (Status Licenciamento)
// O backend só emite estes valores; "Todos" (value: '') não filtra o eixo.

type FilterField = 'cert_status' | 'site_status' | 'license_status';

interface StatusFilterOption {
  value: string;
  label: string;
  activeBg: string;
  dotColor: string;
}

interface StatusFilterGroup {
  field: FilterField;
  label: string;
  options: StatusFilterOption[];
}

const ALL_OPTION: StatusFilterOption = {
  value: '',
  label: 'Todos',
  activeBg: 'bg-slate-900 text-white shadow-sm',
  dotColor: 'bg-slate-400',
};

const STATUS_FILTER_GROUPS: StatusFilterGroup[] = [
  {
    field: 'cert_status',
    label: 'Status Certificacao',
    options: [
      ALL_OPTION,
      {
        value: 'ATIVO',
        label: 'Ativo',
        activeBg: 'bg-emerald-600 text-white shadow-sm',
        dotColor: 'bg-emerald-500',
      },
      {
        value: 'ENCERRADO',
        label: 'Encerrado',
        activeBg: 'bg-pink-600 text-white shadow-sm',
        dotColor: 'bg-pink-500',
      },
    ],
  },
  {
    field: 'site_status',
    label: 'Status Ecommerce',
    options: [
      ALL_OPTION,
      {
        value: 'CONFORME',
        label: 'Conforme',
        activeBg: 'bg-emerald-600 text-white shadow-sm',
        dotColor: 'bg-emerald-500',
      },
      {
        value: 'NAO_CONFORME',
        label: 'Nao conforme',
        activeBg: 'bg-pink-600 text-white shadow-sm',
        dotColor: 'bg-pink-500',
      },
    ],
  },
  {
    field: 'license_status',
    label: 'Status Licenciamento',
    options: [
      ALL_OPTION,
      {
        value: 'VALIDO',
        label: 'Valido',
        activeBg: 'bg-emerald-600 text-white shadow-sm',
        dotColor: 'bg-emerald-500',
      },
      {
        value: 'VENCIDO',
        label: 'Vencido',
        activeBg: 'bg-pink-600 text-white shadow-sm',
        dotColor: 'bg-pink-500',
      },
      {
        value: 'NAO_APLICAVEL',
        label: 'Nao aplicavel',
        activeBg: 'bg-slate-500 text-white shadow-sm',
        dotColor: 'bg-slate-400',
      },
    ],
  },
];

interface StatusFilterState {
  cert_status: string;
  site_status: string;
  license_status: string;
}

const EMPTY_STATUS_FILTERS: StatusFilterState = {
  cert_status: '',
  site_status: '',
  license_status: '',
};

/**
 * Pure predicate: true when a product matches the active semantic filters.
 * Empty filter value on an axis means "no constraint" for that axis.
 * Exported for unit testing.
 */
export function matchesStatusFilters(
  product: Pick<CertProduct, 'cert_status' | 'site_status' | 'license_status'>,
  filters: StatusFilterState,
): boolean {
  if (filters.cert_status && product.cert_status !== filters.cert_status) return false;
  if (filters.site_status && product.site_status !== filters.site_status) return false;
  if (filters.license_status && product.license_status !== filters.license_status) return false;
  return true;
}

const BRAND_FILTERS = [
  { value: '', label: 'Todas' },
  { value: 'imaginarium', label: 'Imaginarium' },
  { value: 'puket', label: 'Puket' },
  { value: 'puket_escolares', label: 'Puket Escolares' },
];

type SortField = 'sku' | 'name' | 'brand' | 'last_validation_status' | 'last_validation_score';
type SortDir = 'asc' | 'desc';

export default function CertProdutosPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [products, setProducts] = useState<CertProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [perPage] = useState(25);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [brand, setBrand] = useState('');
  const [statusFilters, setStatusFilters] = useState<StatusFilterState>(() => ({
    cert_status: searchParams.get('cert_status') || '',
    site_status: searchParams.get('site_status') || '',
    license_status: searchParams.get('license_status') || '',
  }));
  const [lastDate, setLastDate] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sortField, setSortField] = useState<SortField>('sku');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchCertProducts({
        page,
        per_page: perPage,
        search: search || undefined,
        brand: brand || undefined,
        cert_status: statusFilters.cert_status || undefined,
        site_status: statusFilters.site_status || undefined,
        license_status: statusFilters.license_status || undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
      });
      setProducts(data.products || []);
      setTotalPages(data.total_pages || 1);
      setTotal(data.total || 0);
      setLastDate(data.last_validation_date || null);
      setLoadError(null);
    } catch {
      setLoadError('Nao foi possivel carregar os produtos. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }, [
    page,
    perPage,
    search,
    brand,
    statusFilters.cert_status,
    statusFilters.site_status,
    statusFilters.license_status,
    startDate,
    endDate,
  ]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  function handleStatusFilterChange(field: FilterField, value: string) {
    setStatusFilters((prev) => {
      const next = { ...prev, [field]: value };
      const params: Record<string, string> = {};
      if (next.cert_status) params.cert_status = next.cert_status;
      if (next.site_status) params.site_status = next.site_status;
      if (next.license_status) params.license_status = next.license_status;
      setSearchParams(params);
      return next;
    });
    setPage(1);
  }

  function handleBrandChange(newBrand: string) {
    setBrand(newBrand);
    setPage(1);
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput);
  }

  function clearFilters() {
    setStatusFilters(EMPTY_STATUS_FILTERS);
    setBrand('');
    setSearch('');
    setSearchInput('');
    setStartDate('');
    setEndDate('');
    setPage(1);
    setSearchParams({});
  }

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  const sortedProducts = products
    .filter((p) => matchesStatusFilters(p, statusFilters))
    .sort((a, b) => {
    const aVal = a[sortField] ?? '';
    const bVal = b[sortField] ?? '';
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
    }
    const cmp = String(aVal).localeCompare(String(bVal), 'pt-BR', { sensitivity: 'base' });
    return sortDir === 'asc' ? cmp : -cmp;
  });

  async function handleVerify(sku: string, productBrand: string) {
    setVerifying(sku);
    try {
      const brandKey = productBrand.toLowerCase().replaceAll(' ', '_');
      const result = await verifyCertProduct(sku, brandKey);
      setProducts((prev) =>
        prev.map((p) =>
          p.sku === sku
            ? {
                ...p,
                last_validation_status: result.status,
                last_validation_score: result.score,
                last_validation_url: result.url,
                last_validation_date: result.verified_at,
              }
            : p,
        ),
      );
    } catch {
      // Silently handle
    } finally {
      setVerifying(null);
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-30" />;
    return sortDir === 'asc' ? (
      <ArrowUp className="w-3 h-3 ml-1 text-emerald-600" />
    ) : (
      <ArrowDown className="w-3 h-3 ml-1 text-emerald-600" />
    );
  }

  function getSortState(field: SortField) {
    if (sortField !== field) return 'none';
    return sortDir === 'asc' ? 'ascending' : 'descending';
  }

  function SortHeader({ field, label }: { field: SortField; label: string }) {
    return (
      <th
        aria-sort={getSortState(field)}
        className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 transition-colors dark:text-slate-300"
      >
        <button
          type="button"
          onClick={() => handleSort(field)}
          className="flex items-center rounded-md text-left uppercase tracking-wider hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-slate-900"
        >
          {label} <SortIcon field={field} />
        </button>
      </th>
    );
  }

  const hasActiveFilters =
    statusFilters.cert_status ||
    statusFilters.site_status ||
    statusFilters.license_status ||
    brand ||
    search ||
    startDate ||
    endDate;

  return (
    <div className="space-y-5 animate-fade-in">
      {loadError && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-2xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700 sm:flex-row sm:items-center sm:justify-between"
        >
          <span>{loadError}</span>
          <button
            type="button"
            onClick={loadProducts}
            className="rounded-lg border border-danger-200 bg-white px-3 py-1.5 text-xs font-semibold text-danger-700 transition-colors hover:bg-danger-100"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* ── Status Filter Tabs (semantic axes) ── */}
      <div className="rounded-2xl border border-slate-200/60 dark:border-slate-700/60 shadow-sm bg-white dark:bg-slate-800 p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            Filtros de Status
          </span>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="ml-auto flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-danger-500 transition-colors"
            >
              <X className="w-3 h-3" /> Limpar filtros
            </button>
          )}
        </div>
        <div className="flex flex-col gap-3">
          {STATUS_FILTER_GROUPS.map((group) => {
            const activeValue = statusFilters[group.field];
            return (
              <div key={group.field} className="flex flex-col gap-1.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  {group.label}
                </span>
                <div className="flex flex-wrap gap-2">
                  {group.options.map((opt) => {
                    const isActive = activeValue === opt.value;
                    return (
                      <button
                        key={`${group.field}-${opt.value || 'all'}`}
                        type="button"
                        onClick={() => handleStatusFilterChange(group.field, opt.value)}
                        aria-pressed={isActive}
                        className={cn(
                          'group relative flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-200',
                          isActive
                            ? opt.activeBg
                            : 'bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200/60 dark:border-slate-700/60',
                        )}
                      >
                        <span
                          className={cn(
                            'w-1.5 h-1.5 rounded-full shrink-0',
                            isActive ? 'bg-white/90' : opt.dotColor,
                          )}
                        />
                        <span>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Search + Brand Filters ── */}
      <div className="rounded-2xl border border-slate-200/60 dark:border-slate-700/60 shadow-sm bg-white dark:bg-slate-800 p-4">
        <div className="flex flex-col lg:flex-row items-start lg:items-center gap-4">
          {/* Search */}
          <form onSubmit={handleSearch} className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                id="cert-products-search"
                type="text"
                aria-label="Buscar produto por SKU ou nome"
                placeholder="Buscar por SKU ou nome..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-300 placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none transition-all"
              />
            </div>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-emerald-600 to-emerald-700 text-white hover:from-emerald-700 hover:to-emerald-800 active:scale-[0.98] transition-all shadow-sm"
            >
              Buscar
            </button>
          </form>

          {/* Date Range Filter */}
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

          {/* Brand Filter Pills */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mr-1.5 hidden lg:block">
              Marca
            </span>
            {BRAND_FILTERS.map((b) => {
              const isActive = brand === b.value;
              return (
                <button
                  key={b.value}
                  type="button"
                  onClick={() => handleBrandChange(b.value)}
                  aria-pressed={isActive}
                  className={cn(
                    'px-3.5 py-2 rounded-xl text-xs font-semibold transition-all duration-200',
                    isActive
                      ? 'bg-violet-600 text-white shadow-md shadow-sm'
                      : 'bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200/60 dark:border-slate-700/60',
                  )}
                >
                  {b.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Summary line */}
        <div className="flex items-center justify-between mt-4 pt-3.5 border-t border-slate-100 dark:border-slate-700">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-slate-700 dark:text-slate-300">{total}</span>{' '}
            produto
            {total !== 1 ? 's' : ''} encontrado{total !== 1 ? 's' : ''}
            {lastDate && (
              <span className="ml-3 text-slate-400">
                Ultima validacao: {formatDateTime(lastDate)}
              </span>
            )}
          </p>
          <button
            type="button"
            onClick={loadProducts}
            disabled={loading}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-900 active:scale-[0.98] transition-all"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            Atualizar
          </button>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="rounded-2xl border border-slate-200/60 dark:border-slate-700/60 shadow-sm bg-white dark:bg-slate-800 overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3 overflow-x-auto">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="h-4 w-20 bg-slate-100 dark:bg-slate-700 rounded-lg animate-pulse" />
                <div className="h-4 flex-1 bg-slate-100 dark:bg-slate-700 rounded-lg animate-pulse" />
                <div className="h-4 w-16 bg-slate-100 dark:bg-slate-700 rounded-lg animate-pulse" />
                <div className="h-4 w-20 bg-slate-100 dark:bg-slate-700 rounded-lg animate-pulse" />
                <div className="h-4 w-12 bg-slate-100 dark:bg-slate-700 rounded-lg animate-pulse" />
                <div className="h-4 w-24 bg-slate-100 dark:bg-slate-700 rounded-lg animate-pulse" />
              </div>
            ))}
          </div>
        ) : sortedProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900 mb-4">
              <Package className="w-8 h-8" />
            </div>
            <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
              Nenhum produto encontrado
            </p>
            <p className="text-xs mt-1 text-slate-400">Ajuste os filtros ou busca</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1200px]">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200/60 dark:border-slate-700/60">
                  <SortHeader field="sku" label="SKU" />
                  <SortHeader field="name" label="Nome" />
                  <SortHeader field="brand" label="Marca" />
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Status Certificacao
                  </th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Cert. - Prazo
                  </th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Status Ecommerce
                  </th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Status Licenciamento
                  </th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Licen. - Prazo
                  </th>
                  <th className="text-right px-4 py-3.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    CD
                  </th>
                  <th className="text-right px-4 py-3.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    E-com
                  </th>
                  <th className="text-right px-4 py-3.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Total
                  </th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Acoes
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/80">
                {sortedProducts.map((p) => (
                  <tr
                    key={p.sku}
                    className={cn(
                      'group transition-colors',
                      p.is_expired
                        ? 'bg-pink-50/40 hover:bg-pink-50/70'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/60',
                    )}
                  >
                    <td className="px-5 py-3.5 font-mono text-xs font-semibold text-slate-700 dark:text-slate-300">
                      <Link
                        to={`/certificacoes/produtos/${encodeURIComponent(p.sku)}`}
                        className="hover:text-emerald-600 transition-colors"
                      >
                        {p.sku}
                      </Link>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-slate-700 dark:text-slate-300 max-w-[300px] truncate">
                      <Link
                        to={`/certificacoes/produtos/${encodeURIComponent(p.sku)}`}
                        className="hover:text-emerald-600 transition-colors"
                      >
                        {p.name}
                      </Link>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 px-2.5 py-1 rounded-lg">
                        {p.brand}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      {p.cert_status ? (
                        <CertStatusBadge status={p.cert_status} />
                      ) : (
                        <span className="text-xs text-slate-300 font-medium">--</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      {p.sale_deadline ? (
                        <span
                          className={cn(
                            'text-xs font-medium whitespace-nowrap px-2 py-1 rounded-lg',
                            p.is_expired
                              ? 'text-pink-700 bg-pink-50'
                              : 'text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-900',
                          )}
                        >
                          {p.sale_deadline}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-300 font-medium">--</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      {p.site_status ? (
                        <CertStatusBadge status={p.site_status} />
                      ) : (
                        <span className="text-xs text-slate-300 font-medium">--</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      {p.license_status ? (
                        <CertStatusBadge status={p.license_status} />
                      ) : (
                        <span className="text-xs text-slate-300 font-medium">--</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      {/* Prazo de licenciamento (distinto de sale_deadline) */}
                      {p.license_deadline ? (
                        <span
                          className={cn(
                            'text-xs font-medium whitespace-nowrap px-2 py-1 rounded-lg',
                            p.license_status === 'VENCIDO'
                              ? 'text-pink-700 bg-pink-50'
                              : 'text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-900',
                          )}
                        >
                          {p.license_deadline}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-300 font-medium">--</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      {(p.stock_cd ?? 0) > 0 ? (
                        <div className="group/cd relative inline-block">
                          <button
                            type="button"
                            aria-label={`Mostrar estoque CD do SKU ${p.sku}`}
                            className="text-xs font-mono font-semibold tabular-nums text-slate-700 dark:text-slate-300 underline decoration-dotted underline-offset-2 hover:text-emerald-600 cursor-pointer"
                          >
                            {(p.stock_cd ?? 0).toLocaleString('pt-BR')}
                          </button>
                          <div className="absolute z-50 bottom-full right-0 mb-2 hidden group-hover/cd:block">
                            <div className="bg-slate-800 text-white text-[11px] rounded-xl shadow-xl px-3 py-2.5 whitespace-nowrap min-w-[220px]">
                              <p className="font-bold text-[10px] uppercase tracking-wider text-slate-400 mb-1.5">
                                CD Biguacu - Localizacao
                              </p>
                              {(p.stock_detail ?? [])
                                .filter(
                                  (d: any) =>
                                    d.source === 'wms_biguacu' &&
                                    (d.available > 0 || d.quantity > 0),
                                )
                                .sort(
                                  (a: any, b: any) =>
                                    (b.available ?? b.quantity ?? 0) -
                                    (a.available ?? a.quantity ?? 0),
                                )
                                .map((d: any, i: number) => (
                                  <div key={i} className="flex justify-between gap-4 py-0.5">
                                    <span className="text-slate-300">
                                      {(d.warehouse || '').replace('CD ', '')}
                                      {d.synced_at && (
                                        <span className="ml-2 text-slate-500">
                                          {formatDateTime(d.synced_at)}
                                        </span>
                                      )}
                                    </span>
                                    <span className="font-mono font-bold">
                                      {(d.available ?? d.quantity ?? 0).toLocaleString('pt-BR')}
                                    </span>
                                  </div>
                                ))}
                              {(p.stock_detail ?? []).filter(
                                (d: any) =>
                                  d.source === 'wms_biguacu' && (d.available > 0 || d.quantity > 0),
                              ).length === 0 && <p className="text-slate-400">Sem detalhe</p>}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs font-mono tabular-nums text-slate-300">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <span
                        className={cn(
                          'text-xs font-mono tabular-nums',
                          (p.stock_ecommerce ?? 0) > 0
                            ? 'text-slate-700 dark:text-slate-300 font-semibold'
                            : 'text-slate-300',
                        )}
                      >
                        {(p.stock_ecommerce ?? 0).toLocaleString('pt-BR')}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <span
                        className={cn(
                          'text-xs font-mono font-bold tabular-nums px-2 py-0.5 rounded',
                          (p.stock_total ?? 0) > 0
                            ? 'text-emerald-700 bg-emerald-50'
                            : 'text-danger-600 bg-danger-50',
                        )}
                      >
                        {(p.stock_total ?? 0).toLocaleString('pt-BR')}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleVerify(p.sku, p.brand)}
                          disabled={verifying === p.sku}
                          className={cn(
                            'flex min-h-8 items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all',
                            verifying === p.sku
                              ? 'bg-slate-100 dark:bg-slate-700 text-slate-400 cursor-not-allowed'
                              : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 active:scale-[0.97]',
                          )}
                        >
                          {verifying === p.sku ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <ShieldCheck className="w-3 h-3" />
                          )}
                          Verificar
                        </button>
                        {p.last_validation_url && (
                          <a
                            href={p.last_validation_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Abrir validacao do SKU ${p.sku} em nova aba`}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-all"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-5 py-4 border-t border-slate-100 dark:border-slate-700/80 bg-slate-50/40">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Pagina{' '}
              <span className="font-semibold text-slate-700 dark:text-slate-300">{page}</span> de{' '}
              <span className="font-semibold text-slate-700 dark:text-slate-300">{totalPages}</span>
            </p>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page <= 1}
                aria-label="Pagina anterior"
                className="p-2 rounded-xl text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-900 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 7) {
                  pageNum = i + 1;
                } else if (page <= 4) {
                  pageNum = i + 1;
                } else if (page >= totalPages - 3) {
                  pageNum = totalPages - 6 + i;
                } else {
                  pageNum = page - 3 + i;
                }
                return (
                  <button
                    key={pageNum}
                    type="button"
                    onClick={() => setPage(pageNum)}
                    aria-current={page === pageNum ? 'page' : undefined}
                    aria-label={`Ir para pagina ${pageNum}`}
                    className={cn(
                      'w-9 h-9 rounded-xl text-xs font-semibold transition-all',
                      page === pageNum
                        ? 'bg-gradient-to-r from-emerald-600 to-emerald-700 text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 bg-white border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-900',
                    )}
                  >
                    {pageNum}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages}
                aria-label="Proxima pagina"
                className="p-2 rounded-xl text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-900 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
