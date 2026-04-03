import { useEffect, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CertStatusBadge } from '@/features/certificacoes/components/CertStatusBadge';
import { fetchCertProducts, fetchCertStats, verifyCertProduct } from '@/shared/lib/cert-api-client';
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
  CheckCircle2,
  AlertTriangle,
  SearchX,
  Ban,
  CalendarX2,
  LayoutGrid,
  X,
} from 'lucide-react';

// ── Filter config ──────────────────────────────────────────────────────

const STATUS_FILTERS = [
  {
    value: '',
    label: 'Todos',
    icon: LayoutGrid,
    color: 'text-slate-600',
    activeBg: 'bg-slate-900 text-white shadow-sm',
    dotColor: 'bg-slate-400',
    countKey: 'total' as const,
  },
  {
    value: 'OK',
    label: 'Conforme',
    icon: CheckCircle2,
    color: 'text-emerald-700',
    activeBg: 'bg-emerald-600 text-white shadow-sm',
    dotColor: 'bg-emerald-500',
    countKey: 'ok' as const,
  },
  {
    value: 'INCONSISTENT',
    label: 'Inconsistente',
    icon: AlertTriangle,
    color: 'text-amber-700',
    activeBg: 'bg-amber-500 text-white shadow-sm',
    dotColor: 'bg-amber-500',
    countKey: 'inconsistent' as const,
  },
  {
    value: 'URL_NOT_FOUND',
    label: 'Nao Encontrado',
    icon: SearchX,
    color: 'text-slate-600',
    activeBg: 'bg-slate-600 text-white shadow-sm',
    dotColor: 'bg-slate-400',
    countKey: 'not_found' as const,
  },
  {
    value: 'EXPIRED',
    label: 'Vencido',
    icon: CalendarX2,
    color: 'text-pink-700',
    activeBg: 'bg-pink-600 text-white shadow-sm',
    dotColor: 'bg-pink-500',
    countKey: 'expired' as const,
  },
  {
    value: 'NO_EXPECTED',
    label: 'Sem Cert.',
    icon: Ban,
    color: 'text-slate-500',
    activeBg: 'bg-slate-500 text-white shadow-sm',
    dotColor: 'bg-slate-300',
    countKey: 'no_expected' as const,
  },
];

const BRAND_FILTERS = [
  { value: '', label: 'Todas' },
  { value: 'imaginarium', label: 'Imaginarium' },
  { value: 'puket', label: 'Puket' },
  { value: 'puket_escolares', label: 'Puket Escolares' },
];

import type { CertProduct } from '@/shared/lib/cert-api-client';

interface StatusCounts {
  total: number;
  ok: number;
  inconsistent: number;
  not_found: number;
  expired: number;
  no_expected: number;
}

type SortField = 'sku' | 'name' | 'brand' | 'last_validation_status' | 'last_validation_score';
type SortDir = 'asc' | 'desc';

export default function CertProdutosPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [products, setProducts] = useState<CertProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [perPage] = useState(25);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [brand, setBrand] = useState('');
  const [status, setStatus] = useState(() => searchParams.get('status') || '');
  const [lastDate, setLastDate] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sortField, setSortField] = useState<SortField>('sku');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [counts, setCounts] = useState<StatusCounts>({
    total: 0,
    ok: 0,
    inconsistent: 0,
    not_found: 0,
    expired: 0,
    no_expected: 0,
  });

  // Load stats for counts
  useEffect(() => {
    fetchCertStats()
      .then((stats: any) => {
        const byBrand = stats?.by_brand || [];
        const totals = byBrand.reduce(
          (acc: StatusCounts, b: any) => ({
            total:
              acc.total +
              (b.ok || 0) +
              (b.missing || 0) +
              (b.inconsistent || 0) +
              (b.not_found || 0),
            ok: acc.ok + (b.ok || 0),
            inconsistent: acc.inconsistent + (b.inconsistent || 0),
            not_found: acc.not_found + (b.not_found || 0) + (b.missing || 0),
            expired: acc.expired + (b.expired || 0),
            no_expected: acc.no_expected + (b.no_expected || 0),
          }),
          {
            total: 0,
            ok: 0,
            inconsistent: 0,
            not_found: 0,
            expired: 0,
            no_expected: 0,
          },
        );
        setCounts(totals);
      })
      .catch(() => {});
  }, []);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchCertProducts({
        page,
        per_page: perPage,
        search: search || undefined,
        brand: brand || undefined,
        status: status || undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
      });
      setProducts(data.products || []);
      setTotalPages(data.total_pages || 1);
      setTotal(data.total || 0);
      setLastDate(data.last_validation_date || null);
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [page, perPage, search, brand, status, startDate, endDate]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  function handleStatusChange(newStatus: string) {
    setStatus(newStatus);
    setPage(1);
    if (newStatus) {
      setSearchParams({ status: newStatus });
    } else {
      setSearchParams({});
    }
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
    setStatus('');
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

  const hasActiveFilters = status || brand || search || startDate || endDate;

  return (
    <div className="space-y-5">
      {/* ── Status Filter Tabs ── */}
      <div className="rounded-2xl border border-slate-200/60 shadow-sm bg-white p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            Status
          </span>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="ml-auto flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-danger-500 transition-colors"
            >
              <X className="w-3 h-3" /> Limpar filtros
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((f) => {
            const isActive = status === f.value;
            const count = counts[f.countKey];
            return (
              <button
                key={f.value}
                onClick={() => handleStatusChange(f.value)}
                className={cn(
                  'group relative flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200',
                  isActive
                    ? f.activeBg
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200/60',
                )}
              >
                <f.icon className={cn('w-3.5 h-3.5', isActive ? 'text-white/90' : f.color)} />
                <span>{f.label}</span>
                {count > 0 && (
                  <span
                    className={cn(
                      'min-w-[22px] h-[22px] flex items-center justify-center rounded-full text-[10px] font-bold tabular-nums leading-none px-1.5',
                      isActive
                        ? 'bg-white/20 text-white'
                        : 'bg-white text-slate-500 shadow-sm border border-slate-200/60',
                    )}
                  >
                    {count > 999 ? `${(count / 1000).toFixed(0)}k` : count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Search + Brand Filters ── */}
      <div className="rounded-2xl border border-slate-200/60 shadow-sm bg-white p-4">
        <div className="flex flex-col lg:flex-row items-start lg:items-center gap-4">
          {/* Search */}
          <form onSubmit={handleSearch} className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar por SKU ou nome..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none transition-all"
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
                  onClick={() => handleBrandChange(b.value)}
                  className={cn(
                    'px-3.5 py-2 rounded-xl text-xs font-semibold transition-all duration-200',
                    isActive
                      ? 'bg-violet-600 text-white shadow-md shadow-sm'
                      : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200/60',
                  )}
                >
                  {b.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Summary line */}
        <div className="flex items-center justify-between mt-4 pt-3.5 border-t border-slate-100">
          <p className="text-sm text-slate-500">
            <span className="font-semibold text-slate-700">{total}</span> produto
            {total !== 1 ? 's' : ''} encontrado{total !== 1 ? 's' : ''}
            {lastDate && (
              <span className="ml-3 text-slate-400">
                Ultima validacao: {formatDateTime(lastDate)}
              </span>
            )}
          </p>
          <button
            onClick={loadProducts}
            disabled={loading}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-medium text-slate-600 border border-slate-200 bg-white hover:bg-slate-50 active:scale-[0.98] transition-all"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            Atualizar
          </button>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="rounded-2xl border border-slate-200/60 shadow-sm bg-white overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="h-4 w-20 bg-slate-100 rounded-lg animate-pulse" />
                <div className="h-4 flex-1 bg-slate-100 rounded-lg animate-pulse" />
                <div className="h-4 w-16 bg-slate-100 rounded-lg animate-pulse" />
                <div className="h-4 w-20 bg-slate-100 rounded-lg animate-pulse" />
                <div className="h-4 w-12 bg-slate-100 rounded-lg animate-pulse" />
                <div className="h-4 w-24 bg-slate-100 rounded-lg animate-pulse" />
              </div>
            ))}
          </div>
        ) : sortedProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <div className="p-4 rounded-2xl bg-slate-50 mb-4">
              <Package className="w-8 h-8" />
            </div>
            <p className="text-sm font-semibold text-slate-500">Nenhum produto encontrado</p>
            <p className="text-xs mt-1 text-slate-400">Ajuste os filtros ou busca</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200/60">
                <th
                  className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-slate-700 transition-colors"
                  onClick={() => handleSort('sku')}
                >
                  <span className="flex items-center">
                    SKU <SortIcon field="sku" />
                  </span>
                </th>
                <th
                  className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-slate-700 transition-colors"
                  onClick={() => handleSort('name')}
                >
                  <span className="flex items-center">
                    Nome <SortIcon field="name" />
                  </span>
                </th>
                <th
                  className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-slate-700 transition-colors"
                  onClick={() => handleSort('brand')}
                >
                  <span className="flex items-center">
                    Marca <SortIcon field="brand" />
                  </span>
                </th>
                <th
                  className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-slate-700 transition-colors"
                  onClick={() => handleSort('last_validation_status')}
                >
                  <span className="flex items-center">
                    Status <SortIcon field="last_validation_status" />
                  </span>
                </th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Prazo de Venda
                </th>
                <th className="text-right px-4 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  CD
                </th>
                <th className="text-right px-4 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  E-com
                </th>
                <th className="text-right px-4 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Total
                </th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Acoes
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100/80">
              {sortedProducts.map((p) => (
                <tr
                  key={p.sku}
                  className={cn(
                    'group transition-colors',
                    p.is_expired ? 'bg-pink-50/40 hover:bg-pink-50/70' : 'hover:bg-slate-50/60',
                  )}
                >
                  <td className="px-5 py-3.5 font-mono text-xs font-semibold text-slate-700">
                    <Link
                      to={`/certificacoes/produtos/${encodeURIComponent(p.sku)}`}
                      className="hover:text-emerald-600 transition-colors"
                    >
                      {p.sku}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 text-sm text-slate-700 max-w-[300px] truncate">
                    <Link
                      to={`/certificacoes/produtos/${encodeURIComponent(p.sku)}`}
                      className="hover:text-emerald-600 transition-colors"
                    >
                      {p.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="text-xs font-medium text-slate-500 bg-slate-50 px-2.5 py-1 rounded-lg">
                      {p.brand}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    {p.last_validation_status ? (
                      <CertStatusBadge status={p.last_validation_status} />
                    ) : p.is_expired ? (
                      <CertStatusBadge status="EXPIRED" />
                    ) : (
                      <span className="text-xs text-slate-300 font-medium">--</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    {p.sale_deadline ? (
                      <span
                        className={cn(
                          'text-xs font-medium whitespace-nowrap px-2 py-1 rounded-lg',
                          p.is_expired ? 'text-pink-700 bg-pink-50' : 'text-slate-600 bg-slate-50',
                        )}
                      >
                        {p.sale_deadline}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-300 font-medium">--</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    {(p.stock_cd ?? 0) > 0 ? (
                      <div className="group/cd relative inline-block">
                        <button className="text-xs font-mono font-semibold tabular-nums text-slate-700 underline decoration-dotted underline-offset-2 hover:text-emerald-600 cursor-pointer">
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
                                  d.source === 'wms_biguacu' && (d.available > 0 || d.quantity > 0),
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
                          ? 'text-slate-700 font-semibold'
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
                        onClick={() => handleVerify(p.sku, p.brand)}
                        disabled={verifying === p.sku}
                        className={cn(
                          'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all',
                          verifying === p.sku
                            ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
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
        )}

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-4 border-t border-slate-100/80 bg-slate-50/40">
            <p className="text-sm text-slate-500">
              Pagina <span className="font-semibold text-slate-700">{page}</span> de{' '}
              <span className="font-semibold text-slate-700">{totalPages}</span>
            </p>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page <= 1}
                className="p-2 rounded-xl text-slate-500 border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
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
                    onClick={() => setPage(pageNum)}
                    className={cn(
                      'w-9 h-9 rounded-xl text-xs font-semibold transition-all',
                      page === pageNum
                        ? 'bg-gradient-to-r from-emerald-600 to-emerald-700 text-white shadow-sm'
                        : 'text-slate-600 bg-white border border-slate-200 hover:bg-slate-50',
                    )}
                  >
                    {pageNum}
                  </button>
                );
              })}
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages}
                className="p-2 rounded-xl text-slate-500 border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
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
