import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Upload,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Package,
  FileSpreadsheet,
  ChevronDown,
  ChevronUp,
  Search,
  XCircle,
  X,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  SlidersHorizontal,
  Calendar,
  Filter,
} from 'lucide-react';
import { useApiQuery } from '@/shared/hooks/useApi';
import { useQueryClient } from '@tanstack/react-query';
import { cn, formatDate } from '@/shared/lib/utils';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';

interface PreConsItem {
  id: number;
  processCode: string | null;
  orderDescription: string | null;
  etd: string | null;
  collection: string | null;
  portOfLoading: string | null;
  supplier: string | null;
  productName: string | null;
  itemCode: string | null;
  quantity: number | null;
  agreedPrice: string | null;
  ncmCode: string | null;
  amount: string | null;
  cbm: string | null;
  cargoReadyDate: string | null;
  eta: string | null;
  piNumber: string | null;
  sheetName: string | null;
  syncedAt: string;
}

interface SyncLog {
  id: number;
  source: string;
  fileName: string;
  sheetsProcessed: number;
  totalRows: number;
  created: number;
  updated: number;
  errors: number;
  details: Record<string, unknown> | null;
  syncedAt: string;
}

interface Divergence {
  processCode: string;
  field: string;
  preConsValue: string;
  systemValue: string;
  severity: 'info' | 'warning' | 'critical';
}

interface PreConsSummary {
  totalFob: number;
  totalCbm: number;
  totalQuantity: number;
  uniqueProcesses: number;
}

const fieldLabels: Record<string, string> = {
  totalFobValue: 'Valor FOB Total',
  totalCbm: 'CBM Total',
  etd: 'ETD',
};

const severityConfig = {
  critical: {
    bg: 'bg-danger-50',
    border: 'border-danger-100',
    text: 'text-danger-700',
    badge: 'bg-danger-100 text-danger-700',
  },
  warning: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-700',
    badge: 'bg-amber-100 text-amber-700',
  },
  info: {
    bg: 'bg-primary-50',
    border: 'border-primary-200',
    text: 'text-primary-700',
    badge: 'bg-primary-100 text-primary-700',
  },
};

const SORT_OPTIONS = [
  { value: 'processCode', label: 'Processo' },
  { value: 'supplier', label: 'Fornecedor' },
  { value: 'etd', label: 'ETD' },
  { value: 'amount', label: 'Valor' },
  { value: 'quantity', label: 'Quantidade' },
] as const;

type SortField = (typeof SORT_OPTIONS)[number]['value'];

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

function formatCurrency(value: string | null): string {
  if (!value) return '--';
  const num = Number(value);
  if (isNaN(num)) return '--';
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function formatCompactCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString('pt-BR');
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-danger-100 bg-danger-50 dark:bg-danger-950/30 dark:border-danger-800/50 px-4 py-3 text-sm font-medium text-danger-700 dark:text-danger-400">
      <XCircle className="h-4 w-4 shrink-0" />
      {message}
    </div>
  );
}

/** Reusable filter chip */
function FilterChip({
  label,
  value,
  onRemove,
}: {
  label: string;
  value: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 dark:bg-primary-950/30 text-primary-700 dark:text-primary-300 pl-3 pr-1.5 py-1 text-xs font-medium transition-colors">
      <span className="text-primary-500 dark:text-primary-400 font-semibold">{label}:</span>
      <span className="max-w-[120px] truncate">{value}</span>
      <button
        type="button"
        onClick={onRemove}
        className="flex items-center justify-center h-4 w-4 rounded-full hover:bg-primary-200 dark:hover:bg-primary-800 transition-colors"
        aria-label={`Remover filtro ${label}`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

/** Sortable column header */
function SortableHeader({
  label,
  field,
  currentSort,
  currentOrder,
  onSort,
  align = 'left',
}: {
  label: string;
  field: SortField;
  currentSort: SortField;
  currentOrder: 'asc' | 'desc';
  onSort: (field: SortField) => void;
  align?: 'left' | 'right';
}) {
  const isActive = currentSort === field;

  return (
    <th
      className={cn(
        'px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors group',
        align === 'right' ? 'text-right' : 'text-left',
        isActive
          ? 'text-primary-700 dark:text-primary-300'
          : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300',
      )}
      onClick={() => onSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive ? (
          currentOrder === 'asc' ? (
            <ArrowUp className="h-3 w-3 text-primary-500" />
          ) : (
            <ArrowDown className="h-3 w-3 text-primary-500" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-0 group-hover:opacity-40 transition-opacity" />
        )}
      </span>
    </th>
  );
}

/** Non-sortable column header */
function StaticHeader({ label, align = 'left' }: { label: string; align?: 'left' | 'right' }) {
  return (
    <th
      className={cn(
        'px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      {label}
    </th>
  );
}

export function PreConsPage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ success: boolean; message: string } | null>(
    null,
  );

  // Filter state
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [sheetFilter, setSheetFilter] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [etdFrom, setEtdFrom] = useState('');
  const [etdTo, setEtdTo] = useState('');
  const [sortBy, setSortBy] = useState<SortField>('processCode');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [logsExpanded, setLogsExpanded] = useState(false);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Build query string for items
  const itemsQueryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', '50');
    if (search) params.set('search', search);
    if (sheetFilter) params.set('sheetName', sheetFilter);
    if (supplierFilter) params.set('supplier', supplierFilter);
    if (etdFrom) params.set('etdFrom', etdFrom);
    if (etdTo) params.set('etdTo', etdTo);
    params.set('sortBy', sortBy);
    params.set('sortOrder', sortOrder);
    return params.toString();
  }, [page, search, sheetFilter, supplierFilter, etdFrom, etdTo, sortBy, sortOrder]);

  // Build query string for summary (same filters, no pagination/sort)
  const summaryQueryString = useMemo(() => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (sheetFilter) params.set('sheetName', sheetFilter);
    if (supplierFilter) params.set('supplier', supplierFilter);
    if (etdFrom) params.set('etdFrom', etdFrom);
    if (etdTo) params.set('etdTo', etdTo);
    return params.toString();
  }, [search, sheetFilter, supplierFilter, etdFrom, etdTo]);

  const {
    data: itemsResponse,
    isLoading: loadingItems,
    isError: itemsError,
  } = useApiQuery<{
    data: PreConsItem[];
    pagination: { total: number; page: number; limit: number; pages: number };
  }>(['pre-cons-items', itemsQueryString], `/api/pre-cons/items?${itemsQueryString}`);

  const { data: sheetNames, isLoading: loadingSheets } = useApiQuery<string[]>(
    ['pre-cons-sheets'],
    '/api/pre-cons/sheets',
  );

  const { data: suppliers, isLoading: loadingSuppliers } = useApiQuery<string[]>(
    ['pre-cons-suppliers'],
    '/api/pre-cons/suppliers',
  );

  const { data: summary } = useApiQuery<PreConsSummary>(
    ['pre-cons-summary', summaryQueryString],
    `/api/pre-cons/summary?${summaryQueryString}`,
  );

  const {
    data: divergences,
    isLoading: loadingDivergences,
    isError: divergencesError,
  } = useApiQuery<Divergence[]>(['pre-cons-divergences'], '/api/pre-cons/divergences');

  const {
    data: syncLogs,
    isLoading: loadingLogs,
    isError: logsError,
  } = useApiQuery<SyncLog[]>(['pre-cons-sync-logs'], '/api/pre-cons/sync-logs');

  const items = itemsResponse?.data ?? [];
  const pagination = itemsResponse?.pagination;

  // Check if any filter is active
  const hasActiveFilters = !!(search || sheetFilter || supplierFilter || etdFrom || etdTo);

  const clearAllFilters = useCallback(() => {
    setSearchInput('');
    setSearch('');
    setSheetFilter('');
    setSupplierFilter('');
    setEtdFrom('');
    setEtdTo('');
    setPage(1);
  }, []);

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortBy === field) {
        setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortBy(field);
        setSortOrder('asc');
      }
      setPage(1);
    },
    [sortBy],
  );

  async function handleUpload(file: File) {
    if (!/\.xlsx?$/i.test(file.name)) {
      setUploadResult({
        success: false,
        message: 'Apenas arquivos Excel (.xlsx, .xls) sao aceitos.',
      });
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setUploadResult({ success: false, message: 'Arquivo excede o limite de 20MB.' });
      return;
    }

    setUploading(true);
    setUploadResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const token = localStorage.getItem('importacao_token');
      if (!token) {
        setUploadResult({ success: false, message: 'Sessao expirada. Faca login novamente.' });
        return;
      }

      const res = await fetch('/api/pre-cons/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (!res.ok) {
        const errorJson = await res.json().catch(() => null);
        setUploadResult({ success: false, message: errorJson?.error || `Erro ${res.status}` });
        return;
      }

      const json = await res.json();
      if (json.success) {
        setUploadResult({
          success: true,
          message: `${json.data.created} itens importados. ${json.data.divergences?.length ?? 0} divergencias encontradas.`,
        });
        queryClient.invalidateQueries({ queryKey: ['pre-cons-items'] });
        queryClient.invalidateQueries({ queryKey: ['pre-cons-divergences'] });
        queryClient.invalidateQueries({ queryKey: ['pre-cons-sync-logs'] });
        queryClient.invalidateQueries({ queryKey: ['pre-cons-sheets'] });
        queryClient.invalidateQueries({ queryKey: ['pre-cons-suppliers'] });
        queryClient.invalidateQueries({ queryKey: ['pre-cons-summary'] });
      } else {
        setUploadResult({ success: false, message: json.error || 'Erro ao sincronizar' });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro de conexao';
      setUploadResult({ success: false, message });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  const lastSync = syncLogs?.[0];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100 tracking-tight">
            Pre-Conferencia
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Dados da planilha Pre_Cons KIOM — comparados automaticamente com o sistema
          </p>
        </div>

        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className={cn(
              'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors shadow-sm',
              uploading
                ? 'bg-slate-100 dark:bg-slate-700 text-slate-400 cursor-not-allowed'
                : 'bg-primary-600 text-white hover:bg-primary-700',
            )}
          >
            {uploading ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                Importando...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Upload XLSX
              </>
            )}
          </button>
        </div>
      </div>

      {/* Upload result */}
      {uploadResult && (
        <div
          className={cn(
            'flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-medium',
            uploadResult.success
              ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/50 text-emerald-700 dark:text-emerald-400'
              : 'bg-danger-50 dark:bg-danger-950/30 border-danger-100 dark:border-danger-800/50 text-danger-700 dark:text-danger-400',
          )}
        >
          {uploadResult.success ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0" />
          )}
          {uploadResult.message}
        </div>
      )}

      {/* ── Filter Bar ──────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200/60 dark:border-slate-700/60 bg-white dark:bg-slate-800 shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700/60">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filtros
            {lastSync && (
              <span className="ml-auto text-[10px] font-medium normal-case tracking-normal text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                <Clock className="h-3 w-3" />
                Sync: {formatDate(lastSync.syncedAt)} via{' '}
                {lastSync.source === 'email' ? 'e-mail' : 'upload'}
              </span>
            )}
          </div>
        </div>

        <div className="p-4">
          <div className="flex flex-col lg:flex-row flex-wrap gap-3">
            {/* Search input */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-slate-500" />
              <input
                type="text"
                placeholder="Buscar processo, fornecedor, produto, item..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 placeholder-slate-400 dark:placeholder-slate-500 focus:border-primary-500 dark:focus:border-primary-400 focus:ring-2 focus:ring-primary-500/20 dark:focus:ring-primary-400/20 focus:outline-none transition-all"
              />
            </div>

            {/* Supplier dropdown */}
            <div className="min-w-[160px]">
              {loadingSuppliers ? (
                <div className="h-[38px] w-full rounded-lg bg-slate-100 dark:bg-slate-700 animate-pulse" />
              ) : (
                <select
                  value={supplierFilter}
                  onChange={(e) => {
                    setSupplierFilter(e.target.value);
                    setPage(1);
                  }}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 focus:border-primary-500 dark:focus:border-primary-400 focus:ring-2 focus:ring-primary-500/20 dark:focus:ring-primary-400/20 focus:outline-none transition-all"
                >
                  <option value="">Todos fornecedores</option>
                  {suppliers?.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Sheet dropdown */}
            <div className="min-w-[140px]">
              {loadingSheets ? (
                <div className="h-[38px] w-full rounded-lg bg-slate-100 dark:bg-slate-700 animate-pulse" />
              ) : (sheetNames?.length ?? 0) > 1 ? (
                <select
                  value={sheetFilter}
                  onChange={(e) => {
                    setSheetFilter(e.target.value);
                    setPage(1);
                  }}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 focus:border-primary-500 dark:focus:border-primary-400 focus:ring-2 focus:ring-primary-500/20 dark:focus:ring-primary-400/20 focus:outline-none transition-all"
                >
                  <option value="">Todas as abas</option>
                  {sheetNames!.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>

            {/* ETD date range */}
            <div className="flex items-center gap-2 min-w-[280px]">
              <div className="relative flex-1">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
                <input
                  type="date"
                  value={etdFrom}
                  onChange={(e) => {
                    setEtdFrom(e.target.value);
                    setPage(1);
                  }}
                  placeholder="ETD de"
                  title="ETD a partir de"
                  className="w-full pl-9 pr-2 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 focus:border-primary-500 dark:focus:border-primary-400 focus:ring-2 focus:ring-primary-500/20 dark:focus:ring-primary-400/20 focus:outline-none transition-all [color-scheme:light] dark:[color-scheme:dark]"
                />
              </div>
              <span className="text-xs text-slate-400 dark:text-slate-500 font-medium">ate</span>
              <div className="relative flex-1">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
                <input
                  type="date"
                  value={etdTo}
                  onChange={(e) => {
                    setEtdTo(e.target.value);
                    setPage(1);
                  }}
                  placeholder="ETD ate"
                  title="ETD ate"
                  className="w-full pl-9 pr-2 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 focus:border-primary-500 dark:focus:border-primary-400 focus:ring-2 focus:ring-primary-500/20 dark:focus:ring-primary-400/20 focus:outline-none transition-all [color-scheme:light] dark:[color-scheme:dark]"
                />
              </div>
            </div>

            {/* Sort controls */}
            <div className="flex items-center gap-2">
              <select
                value={sortBy}
                onChange={(e) => {
                  setSortBy(e.target.value as SortField);
                  setPage(1);
                }}
                className="rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 focus:border-primary-500 dark:focus:border-primary-400 focus:ring-2 focus:ring-primary-500/20 dark:focus:ring-primary-400/20 focus:outline-none transition-all"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
                  setPage(1);
                }}
                className={cn(
                  'flex items-center justify-center h-[38px] w-[38px] rounded-lg border transition-all',
                  'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900',
                  'text-slate-600 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400',
                  'hover:border-primary-300 dark:hover:border-primary-600',
                  'focus:ring-2 focus:ring-primary-500/20 dark:focus:ring-primary-400/20 focus:outline-none',
                )}
                title={sortOrder === 'asc' ? 'Ordenacao crescente' : 'Ordenacao decrescente'}
              >
                {sortOrder === 'asc' ? (
                  <ArrowUp className="h-4 w-4" />
                ) : (
                  <ArrowDown className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {/* Active filter chips */}
          {hasActiveFilters && (
            <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-slate-700/60">
              <Filter className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
              {search && (
                <FilterChip
                  label="Busca"
                  value={search}
                  onRemove={() => {
                    setSearchInput('');
                    setSearch('');
                  }}
                />
              )}
              {supplierFilter && (
                <FilterChip
                  label="Fornecedor"
                  value={supplierFilter}
                  onRemove={() => setSupplierFilter('')}
                />
              )}
              {sheetFilter && (
                <FilterChip label="Aba" value={sheetFilter} onRemove={() => setSheetFilter('')} />
              )}
              {etdFrom && (
                <FilterChip label="ETD de" value={etdFrom} onRemove={() => setEtdFrom('')} />
              )}
              {etdTo && <FilterChip label="ETD ate" value={etdTo} onRemove={() => setEtdTo('')} />}
              <button
                type="button"
                onClick={clearAllFilters}
                className="ml-1 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-danger-600 dark:hover:text-danger-400 transition-colors underline underline-offset-2"
              >
                Limpar filtros
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Divergences error */}
      {divergencesError && (
        <ErrorBanner message="Erro ao carregar divergencias. Verifique suas permissoes." />
      )}

      {/* Divergences */}
      {(divergences?.length ?? 0) > 0 && (
        <div className="rounded-2xl border border-amber-200/80 dark:border-amber-800/40 bg-amber-50/50 dark:bg-amber-950/20 p-5 space-y-3">
          <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Divergencias Encontradas ({divergences!.length})
          </h3>
          <div className="space-y-2">
            {divergences!.map((d, i) => {
              const cfg = severityConfig[d.severity];
              return (
                <div
                  key={i}
                  className={cn(
                    'flex flex-col sm:flex-row sm:items-center gap-2 rounded-lg border px-3 py-2',
                    cfg.bg,
                    cfg.border,
                  )}
                >
                  <span
                    className={cn(
                      'inline-flex rounded-md px-2 py-0.5 text-xs font-semibold',
                      cfg.badge,
                    )}
                  >
                    {d.severity}
                  </span>
                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {d.processCode}
                  </span>
                  <span className="text-sm text-slate-600 dark:text-slate-400">
                    {fieldLabels[d.field] || d.field}: Pre-Cons <strong>{d.preConsValue}</strong> vs
                    Sistema <strong>{d.systemValue}</strong>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Items Table ─────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200/60 bg-white dark:bg-slate-800 dark:border-slate-700/60 shadow-sm overflow-hidden">
        {/* Table header with inline summary */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-700 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Itens Pre-Conferencia
          </h3>
          {/* Compact summary stats */}
          {summary && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1.5">
                <Package className="h-3.5 w-3.5 text-primary-500 dark:text-primary-400" />
                <span className="font-semibold text-slate-700 dark:text-slate-200">
                  {(pagination?.total ?? 0).toLocaleString('pt-BR')}
                </span>{' '}
                itens
              </span>
              <span className="hidden sm:inline text-slate-300 dark:text-slate-600">|</span>
              <span className="flex items-center gap-1.5">
                <FileSpreadsheet className="h-3.5 w-3.5 text-primary-500 dark:text-primary-400" />
                <span className="font-semibold text-slate-700 dark:text-slate-200">
                  {summary.uniqueProcesses}
                </span>{' '}
                processos
              </span>
              <span className="hidden sm:inline text-slate-300 dark:text-slate-600">|</span>
              <span>
                FOB{' '}
                <span className="font-semibold text-slate-700 dark:text-slate-200">
                  {formatCompactCurrency(summary.totalFob)}
                </span>
              </span>
              <span className="hidden sm:inline text-slate-300 dark:text-slate-600">|</span>
              <span>
                CBM{' '}
                <span className="font-semibold text-slate-700 dark:text-slate-200">
                  {formatCompactNumber(summary.totalCbm)}
                </span>
              </span>
            </div>
          )}
        </div>

        {itemsError ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <XCircle className="h-8 w-8 text-danger-500" />
            <p className="text-sm text-danger-600 dark:text-danger-400 font-medium">
              Erro ao carregar itens.
            </p>
          </div>
        ) : loadingItems ? (
          <LoadingSpinner className="py-12" />
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-700">
              <Package className="h-6 w-6 text-slate-300 dark:text-slate-500" />
            </div>
            <p className="text-sm text-slate-400 dark:text-slate-500 font-medium">
              {hasActiveFilters
                ? 'Nenhum item encontrado para os filtros selecionados.'
                : 'Nenhum dado de Pre-Conferencia importado.'}
            </p>
            {!hasActiveFilters && (
              <p className="text-xs text-slate-400 dark:text-slate-500">
                Faca o upload da planilha XLSX ou aguarde o sync automatico por e-mail.
              </p>
            )}
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearAllFilters}
                className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 underline underline-offset-2 transition-colors"
              >
                Limpar filtros
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-[900px] w-full divide-y divide-slate-100 dark:divide-slate-700 text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900">
                  <tr>
                    <SortableHeader
                      label="Processo"
                      field="processCode"
                      currentSort={sortBy}
                      currentOrder={sortOrder}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      label="Fornecedor"
                      field="supplier"
                      currentSort={sortBy}
                      currentOrder={sortOrder}
                      onSort={handleSort}
                    />
                    <StaticHeader label="Produto" />
                    <StaticHeader label="Cod. Item" />
                    <SortableHeader
                      label="Qtd"
                      field="quantity"
                      currentSort={sortBy}
                      currentOrder={sortOrder}
                      onSort={handleSort}
                      align="right"
                    />
                    <SortableHeader
                      label="Valor"
                      field="amount"
                      currentSort={sortBy}
                      currentOrder={sortOrder}
                      onSort={handleSort}
                      align="right"
                    />
                    <StaticHeader label="NCM" />
                    <SortableHeader
                      label="ETD"
                      field="etd"
                      currentSort={sortBy}
                      currentOrder={sortOrder}
                      onSort={handleSort}
                    />
                    <StaticHeader label="ETA" />
                    <StaticHeader label="Aba" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {items.map((item) => (
                    <tr
                      key={item.id}
                      className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                    >
                      <td className="px-3 py-2 font-semibold text-primary-700 dark:text-primary-400">
                        {item.processCode || (
                          <span className="text-slate-300 dark:text-slate-600">--</span>
                        )}
                      </td>
                      <td
                        className="px-3 py-2 text-slate-600 dark:text-slate-400 max-w-[140px] truncate"
                        title={item.supplier ?? ''}
                      >
                        {item.supplier || '--'}
                      </td>
                      <td
                        className="px-3 py-2 text-slate-700 dark:text-slate-300 max-w-[180px] truncate"
                        title={item.productName ?? ''}
                      >
                        {item.productName || '--'}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-slate-400">
                        {item.itemCode || '--'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-700 dark:text-slate-300">
                        {item.quantity?.toLocaleString('pt-BR') ?? '--'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-700 dark:text-slate-300">
                        {formatCurrency(item.amount)}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-slate-400">
                        {item.ncmCode || '--'}
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                        {item.etd || '--'}
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                        {item.eta || '--'}
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex rounded-md px-2 py-0.5 text-xs font-medium bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400">
                          {item.sheetName || '--'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {pagination && pagination.pages > 1 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-2 border-t border-slate-100 dark:border-slate-700 px-4 py-3">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Pagina {pagination.page} de {pagination.pages} ({pagination.total} itens)
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="rounded-lg border border-slate-200 dark:border-slate-600 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Anterior
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(pagination.pages, p + 1))}
                    disabled={page >= pagination.pages}
                    className="rounded-lg border border-slate-200 dark:border-slate-600 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Proximo
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Sync logs */}
      <div className="rounded-2xl border border-slate-200/60 bg-white dark:bg-slate-800 dark:border-slate-700/60 shadow-sm overflow-hidden">
        <button
          onClick={() => setLogsExpanded(!logsExpanded)}
          className="flex items-center justify-between w-full px-4 py-3 text-sm font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
        >
          <span>Historico de Sincronizacao ({syncLogs?.length ?? 0})</span>
          {logsExpanded ? (
            <ChevronUp className="h-4 w-4 text-slate-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-slate-400" />
          )}
        </button>

        {logsExpanded &&
          (logsError ? (
            <div className="px-4 pb-4">
              <ErrorBanner message="Erro ao carregar historico. Verifique suas permissoes." />
            </div>
          ) : loadingLogs ? (
            <LoadingSpinner className="py-8" />
          ) : (syncLogs?.length ?? 0) === 0 ? (
            <p className="px-4 pb-4 text-sm text-slate-400 dark:text-slate-500">
              Nenhum sync realizado.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[500px] w-full divide-y divide-slate-100 dark:divide-slate-700 text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900">
                  <tr>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Data
                    </th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Fonte
                    </th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Arquivo
                    </th>
                    <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Itens
                    </th>
                    <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Erros
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {syncLogs!.map((log) => (
                    <tr
                      key={log.id}
                      className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                    >
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                        {formatDate(log.syncedAt)}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            'inline-flex rounded-md px-2 py-0.5 text-xs font-semibold',
                            log.source === 'email'
                              ? 'bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300'
                              : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400',
                          )}
                        >
                          {log.source === 'email' ? 'E-mail' : 'Upload'}
                        </span>
                      </td>
                      <td
                        className="px-3 py-2 text-slate-700 dark:text-slate-300 max-w-[200px] truncate"
                        title={log.fileName}
                      >
                        {log.fileName}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-700 dark:text-slate-300">
                        {log.created}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span
                          className={cn(
                            'font-mono',
                            log.errors > 0
                              ? 'text-danger-600 dark:text-danger-400 font-semibold'
                              : 'text-slate-400 dark:text-slate-500',
                          )}
                        >
                          {log.errors}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
      </div>
    </div>
  );
}
