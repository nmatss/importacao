import { useEffect, useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { Link, useSearchParams } from 'react-router-dom';
import { getErrorMessage } from '@/shared/utils/errors';
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
 *
 * NOTE: the cert-api server is now authoritative for cert_status/site_status/
 * license_status filtering AND pagination — it returns the correctly-filtered
 * page plus the real total/total_pages. This helper is therefore NOT used to
 * re-filter the visible page (doing so would shrink a single page below the
 * server's total and desync the "N produtos encontrados" count / pagination).
 * It is kept only as a typed pure guard, exported for unit testing.
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

/**
 * Apenas as colunas que TÊM cabeçalho ordenável. `last_validation_status` e
 * `last_validation_score` estavam aqui sem cabeçalho correspondente.
 */
type SortField = 'sku' | 'name' | 'brand';
type SortDir = 'asc' | 'desc';

const DEFAULT_SORT_FIELD: SortField = 'sku';
const DEFAULT_SORT_DIR: SortDir = 'asc';

/**
 * O cert-api NÃO aceita `sort`/`order`: ele sempre devolve a página ordenada por
 * SKU. A ordenação aqui reordena só os 25 itens já carregados.
 *
 * Decisão (auditoria 2026-08-29): manter os cabeçalhos e ROTULAR o alcance, em
 * vez de removê-los. Sobre uma página de 25 linhas a reordenação local é
 * genuinamente útil para leitura, e removê-la tiraria uma função que funciona;
 * o que não pode ficar de pé é a ILUSÃO de ordenação global — daí o rótulo fixo
 * ao lado da contagem e o `title` em cada cabeçalho.
 */
const SORT_SCOPE_NOTE = 'Ordenação aplicada apenas à página exibida';

/**
 * Estoque sem `stock_synced_at`: o SKU não tem linha em `cert_stock` e o backend
 * devolve 0 por ausência de dado. Renderizar "0" tornava isso indistinguível de
 * um estoque realmente zerado.
 */
const STOCK_UNKNOWN = '—';
const STOCK_UNKNOWN_TITLE =
  'Sem sincronizacao de estoque para este SKU — o valor e desconhecido, nao zero';

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
  const [sortField, setSortField] = useState<SortField>(DEFAULT_SORT_FIELD);
  const [sortDir, setSortDir] = useState<SortDir>(DEFAULT_SORT_DIR);
  /** SKU cujo tooltip de estoque do CD está aberto por clique/foco (item 5). */
  const [openStockSku, setOpenStockSku] = useState<string | null>(null);

  const latestRequest = useRef(0);

  const loadProducts = useCallback(async () => {
    const requestId = ++latestRequest.current;
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
      if (requestId !== latestRequest.current) return;
      setProducts(data.products || []);
      setTotalPages(data.total_pages || 1);
      setTotal(data.total || 0);
      setLastDate(data.last_validation_date || null);
      setLoadError(null);
    } catch {
      if (requestId !== latestRequest.current) return;
      setLoadError('Nao foi possivel carregar os produtos. Tente novamente.');
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
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
    return () => {
      latestRequest.current += 1;
    };
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
    setSortField(DEFAULT_SORT_FIELD);
    setSortDir(DEFAULT_SORT_DIR);
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

  // Server is authoritative for filtering/pagination: render the page it
  // returned as-is, only applying client-side sort on the current page
  // (ver SORT_SCOPE_NOTE).
  const sortedProducts = [...products].sort((a, b) => {
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
    } catch (err) {
      // Surface the failure instead of leaving the row silently unchanged — the
      // verify endpoint hits an external site and is the most-clicked action on
      // this screen (QA audit 2026-06-20, P1-B).
      toast.error(getErrorMessage(err));
    } finally {
      setVerifying(null);
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-30" />;
    return sortDir === 'asc' ? (
      <ArrowUp className="w-3 h-3 ml-1 text-emerald-600 dark:text-emerald-300" />
    ) : (
      <ArrowDown className="w-3 h-3 ml-1 text-emerald-600 dark:text-emerald-300" />
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
          title={SORT_SCOPE_NOTE}
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
          className="flex flex-col gap-3 rounded-2xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700 sm:flex-row sm:items-center sm:justify-between dark:border-danger-700/50 dark:bg-danger-950/30 dark:text-danger-300"
        >
          <span>{loadError}</span>
          <button
            type="button"
            onClick={loadProducts}
            className="rounded-lg border border-danger-200 bg-white px-3 py-1.5 text-xs font-semibold text-danger-700 transition-colors hover:bg-danger-100 dark:border-danger-800 dark:bg-danger-950/40 dark:text-danger-300 dark:hover:bg-danger-900/50"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* ── Status Filter Tabs (semantic axes) ── */}
      <div className="rounded-2xl border border-slate-200/60 dark:border-slate-700/60 shadow-sm bg-white dark:bg-slate-800 p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
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
                <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
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
        <div className="flex flex-wrap items-center gap-4">
          {/* Search */}
          <form
            onSubmit={handleSearch}
            className="flex w-full min-w-0 items-center gap-2.5 sm:w-auto sm:flex-[1_1_320px]"
          >
            <div className="relative min-w-0 flex-1 max-w-md">
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
              className="shrink-0 px-5 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-emerald-600 to-emerald-700 text-white hover:from-emerald-700 hover:to-emerald-800 active:scale-[0.98] transition-all shadow-sm"
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
          <div className="flex max-w-full flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mr-1.5 hidden lg:block">
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
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between mt-4 pt-3.5 border-t border-slate-100 dark:border-slate-700">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-slate-700 dark:text-slate-300">{total}</span>{' '}
            produto
            {total !== 1 ? 's' : ''} encontrado{total !== 1 ? 's' : ''}
            {lastDate && (
              <span className="ml-3 text-slate-500 dark:text-slate-400">
                Ultima validacao: {formatDateTime(lastDate)}
              </span>
            )}
            {totalPages > 1 && (
              <span className="ml-3 text-xs text-slate-500 dark:text-slate-400">
                {SORT_SCOPE_NOTE}
              </span>
            )}
          </p>
          <button
            type="button"
            onClick={loadProducts}
            disabled={loading}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 active:scale-[0.98] transition-all"
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
            <p className="text-xs mt-1 text-slate-500 dark:text-slate-400">
              Ajuste os filtros ou busca
            </p>
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
                    CD disp.
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
                {sortedProducts.map((p) => {
                  // "Sem estoque" e "estoque desconhecido" são coisas diferentes:
                  // um SKU sem linha em `cert_stock` recebe 0 do backend. Só há
                  // dado quando houve sincronização — e uma linha de
                  // `stock_detail` é, por si só, evidência de que houve.
                  const stockKnown =
                    Boolean(p.stock_synced_at) || (p.stock_detail?.length ?? 0) > 0;
                  return (
                    <tr
                      key={p.sku}
                      className={cn(
                        'group transition-colors',
                        p.is_expired
                          ? 'bg-pink-50/40 hover:bg-pink-50/70 dark:bg-pink-950/30 dark:hover:bg-pink-950/50'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/60',
                      )}
                    >
                      <td className="min-w-[200px] px-5 py-3.5 font-mono text-xs font-semibold text-slate-700 dark:text-slate-300">
                        <Link
                          to={`/certificacoes/produtos/${encodeURIComponent(p.sku)}`}
                          className="hover:text-emerald-600 transition-colors dark:hover:text-emerald-300"
                        >
                          {p.sku}
                        </Link>
                      </td>
                      <td className="px-5 py-3.5 text-sm text-slate-700 dark:text-slate-300 max-w-[300px] truncate">
                        <Link
                          to={`/certificacoes/produtos/${encodeURIComponent(p.sku)}`}
                          className="hover:text-emerald-600 transition-colors dark:hover:text-emerald-300"
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
                        {/* Prazo final de venda (coluna G da aba Encerramentos). 28 SKUs
                          têm veredito de venda na coluna H e NENHUMA data em G — nesses
                          a situação da venda é a única informação que existe, e é ela
                          que aparece aqui em vez de um "--" mudo. */}
                        {p.sale_deadline || p.encerramento_status ? (
                          <span
                            className={cn(
                              'text-xs font-medium whitespace-nowrap px-2 py-1 rounded-lg',
                              p.is_expired
                                ? 'text-pink-700 bg-pink-50 dark:text-pink-300 dark:bg-pink-950/40'
                                : 'text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-900',
                            )}
                            title={p.encerramento_status || undefined}
                          >
                            {p.sale_deadline || p.encerramento_status}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-300 font-medium">--</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        {p.site_status ? (
                          <div className="flex flex-col gap-1">
                            <CertStatusBadge status={p.site_status} />
                            {p.site_status === 'NAO_CONFORME' && p.site_status_reason && (
                              <span
                                title={p.site_status_reason}
                                className="text-[11px] leading-tight text-slate-400 dark:text-slate-500 max-w-[200px] line-clamp-2"
                              >
                                {p.site_status_reason}
                              </span>
                            )}
                          </div>
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
                                ? 'text-pink-700 bg-pink-50 dark:text-pink-300 dark:bg-pink-950/40'
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
                        {!stockKnown ? (
                          <span
                            className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400"
                            title={STOCK_UNKNOWN_TITLE}
                          >
                            {STOCK_UNKNOWN}
                          </span>
                        ) : (p.stock_cd ?? 0) > 0 ||
                          (p.stock_detail ?? []).some(
                            (detail) =>
                              detail.source === 'wms_biguacu' && (detail.quantity ?? 0) > 0,
                          ) ? (
                          <div className="group/cd relative inline-block">
                            <button
                              type="button"
                              aria-label={`Mostrar estoque disponivel e fisico do CD para o SKU ${p.sku}`}
                              aria-expanded={openStockSku === p.sku}
                              // Sem onClick/onFocus o tooltip só abria por hover:
                              // inalcançável por teclado e por toque.
                              onClick={() =>
                                setOpenStockSku((prev) => (prev === p.sku ? null : p.sku))
                              }
                              onFocus={() => setOpenStockSku(p.sku)}
                              onBlur={() =>
                                setOpenStockSku((prev) => (prev === p.sku ? null : prev))
                              }
                              className="text-xs font-mono font-semibold tabular-nums text-slate-700 dark:text-slate-300 underline decoration-dotted underline-offset-2 hover:text-emerald-600 cursor-pointer dark:hover:text-emerald-300"
                            >
                              {(p.stock_cd ?? 0).toLocaleString('pt-BR')}
                            </button>
                            <div
                              className={cn(
                                'absolute z-50 bottom-full right-0 mb-2 group-hover/cd:block',
                                openStockSku === p.sku ? 'block' : 'hidden',
                              )}
                            >
                              <div className="bg-slate-800 text-white text-[11px] rounded-xl shadow-xl px-3 py-2.5 whitespace-nowrap min-w-[220px]">
                                <p className="font-bold text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                                  CD Biguacu - Disponivel / Fisico
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
                                        {(d.available ?? 0).toLocaleString('pt-BR')} /{' '}
                                        {(d.quantity ?? 0).toLocaleString('pt-BR')}
                                      </span>
                                    </div>
                                  ))}
                                {(p.stock_detail ?? []).filter(
                                  (d: any) =>
                                    d.source === 'wms_biguacu' &&
                                    (d.available > 0 || d.quantity > 0),
                                ).length === 0 && (
                                  <p className="text-slate-500 dark:text-slate-400">Sem detalhe</p>
                                )}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs font-mono tabular-nums text-slate-300">0</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        {!stockKnown ? (
                          <span
                            className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400"
                            title={STOCK_UNKNOWN_TITLE}
                          >
                            {STOCK_UNKNOWN}
                          </span>
                        ) : (
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
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        {/* Um SKU sem linha em `cert_stock` recebe 0 do backend. Sem
                          `stock_synced_at` isso é DESCONHECIDO, não "zerado" — e
                          não pode ser pintado de vermelho como ruptura real. */}
                        {!stockKnown ? (
                          <span
                            className="text-xs font-mono font-bold tabular-nums px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
                            title={STOCK_UNKNOWN_TITLE}
                          >
                            {STOCK_UNKNOWN}
                          </span>
                        ) : (
                          <div className="flex flex-col items-end gap-0.5">
                            <span
                              className={cn(
                                'text-xs font-mono font-bold tabular-nums px-2 py-0.5 rounded',
                                (p.stock_total ?? 0) > 0
                                  ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/30'
                                  : 'text-danger-600 bg-danger-50 dark:text-danger-300 dark:bg-danger-950/30',
                              )}
                            >
                              {(p.stock_total ?? 0).toLocaleString('pt-BR')}
                            </span>
                            {p.stock_synced_at && (
                              <span
                                className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums"
                                title={`Estoque sincronizado em ${formatDateTime(p.stock_synced_at)}`}
                              >
                                {formatDateTime(p.stock_synced_at)}
                              </span>
                            )}
                          </div>
                        )}
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
                                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 active:scale-[0.97] dark:bg-emerald-950/30 dark:text-emerald-300 dark:hover:bg-emerald-950/30',
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
                              className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-all dark:hover:text-emerald-300 dark:hover:bg-emerald-950/30"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
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
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              <button
                type="button"
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page <= 1}
                aria-label="Pagina anterior"
                className="p-2 rounded-xl text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
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
                className="p-2 rounded-xl text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
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
