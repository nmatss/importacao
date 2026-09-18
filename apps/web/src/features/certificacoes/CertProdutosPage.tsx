import { useEffect, useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { Link, useSearchParams } from 'react-router-dom';
import { getErrorMessage } from '@/shared/utils/errors';
import { CertStatusBadge } from '@/features/certificacoes/components/CertStatusBadge';
import {
  fetchCertGrifes,
  fetchCertProducts,
  fetchLastCertSync,
  syncCertSheets,
  verifyCertProduct,
  type CertSyncRun,
} from '@/shared/lib/cert-api-client';
import { DateRangeFilter } from '@/shared/components/DateRangeFilter';
import { cn, formatDateTime, formatDate } from '@/shared/lib/utils';
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
  DownloadCloud,
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
        value: 'PENDENTE',
        label: 'Pendente',
        activeBg: 'bg-amber-600 text-white shadow-sm',
        dotColor: 'bg-amber-500',
      },
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

/** Rótulo em português do gatilho de `cert_sync_runs` (nunca a chave técnica). */
const SYNC_TRIGGER_LABEL: Record<CertSyncRun['trigger'], string> = {
  manual: 'manual',
  startup: 'na subida do serviço',
  schedule: 'pela validação agendada',
  hourly: 'automática (a cada hora)',
};

/** Quantos SKUs pendentes o aviso da última sincronização nomeia. */
const MAX_SYNC_PENDENCIAS_SHOWN = 12;

function sheetsSyncResult(run: CertSyncRun | null): Record<string, unknown> | null {
  const sheets = run?.result?.sheets;
  return sheets && typeof sheets === 'object' ? (sheets as Record<string, unknown>) : null;
}

/**
 * Motivo REAL da falha da planilha. `error` da execução só diz "a planilha
 * falhou"; a causa acionável (aba, cabeçalho, SKU) mora em `result.sheets.error`
 * — de 12 a 18/09/2026 ela ficou fora da tela e ninguém soube o que corrigir.
 */
export function sheetsSyncCause(run: CertSyncRun | null): string | null {
  const cause = sheetsSyncResult(run)?.error;
  return typeof cause === 'string' && cause.trim() ? cause.trim().replace(/\.$/, '') : null;
}

/** SKUs que sincronizaram mas têm vínculo de certificado a conferir na planilha. */
export function sheetsSyncPendencias(run: CertSyncRun | null): { total: number; skus: string[] } {
  const sheets = sheetsSyncResult(run);
  const list = Array.isArray(sheets?.pendencias) ? sheets.pendencias : [];
  const skus = list
    .map((item) => (item && typeof item === 'object' ? (item as { sku?: unknown }).sku : null))
    .filter((sku): sku is string => typeof sku === 'string' && sku.length > 0);
  const total = Number(sheets?.pendencias_total ?? skus.length);
  return {
    total: Number.isFinite(total) ? total : skus.length,
    skus: skus.slice(0, MAX_SYNC_PENDENCIAS_SHOWN),
  };
}

/**
 * A última execução leu o Linx? Licenciamento, grife e fim de vendas só existem
 * no painel depois dessa leitura; sem ela, um filtro de licenciamento vazio NÃO
 * significa "não há vencidos".
 */
export function linxWasRead(run: CertSyncRun | null): boolean {
  const linx = run?.result?.linx;
  if (!linx || typeof linx !== 'object') return false;
  const { skipped, error, errors } = linx as {
    skipped?: unknown;
    error?: unknown;
    errors?: unknown;
  };
  return !skipped && !error && !(Array.isArray(errors) && errors.length > 0);
}

/**
 * Quebra o "Nº Certificado" (coluna P das abas) em linhas.
 * Alguns produtos recertificados trazem DOIS números separados por quebra de
 * linha (ex.: '6916-2021-BRI-1\n MT-5493/2021'); exibi-los concatenados fazia
 * parecer um número único e impedia a leitura.
 */
export function certificateNumberLines(value?: string | null): string[] {
  return (value ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function CertificateNumberCell({ value }: { value?: string | null }) {
  const lines = certificateNumberLines(value);
  if (lines.length === 0) {
    return <span className="text-xs font-medium text-slate-400 dark:text-slate-500">--</span>;
  }
  return (
    <span
      title={lines.join(' · ')}
      className="flex flex-col gap-0.5 font-mono text-[11px] leading-tight text-slate-600 dark:text-slate-300"
    >
      {lines.map((line) => (
        <span key={line} className="truncate">
          {line}
        </span>
      ))}
    </span>
  );
}

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
  const [grife, setGrife] = useState('');
  const [grifes, setGrifes] = useState<Array<{ grife: string; count: number }>>([]);
  const [semGrife, setSemGrife] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<CertSyncRun | null>(null);
  const syncCause = sheetsSyncCause(lastSync);
  const syncPendencias = sheetsSyncPendencias(lastSync);
  // Filtro de licenciamento por DATA (tudo menos "Pendente") sem o Linx lido.
  const licenseFilterWithoutLinx =
    Boolean(statusFilters.license_status) &&
    statusFilters.license_status !== 'PENDENTE' &&
    !linxWasRead(lastSync);

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
        grife: grife || undefined,
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
    grife,
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

  const loadLastSync = useCallback(async () => {
    try {
      const data = await fetchLastCertSync();
      setLastSync(data.last_run);
    } catch {
      // A última sincronização é informativa: falhar em lê-la não pode
      // esconder a lista de produtos.
      setLastSync(null);
    }
  }, []);

  useEffect(() => {
    loadLastSync();
    fetchCertGrifes()
      .then((data) => {
        setGrifes(data.grifes);
        setSemGrife(data.sem_grife);
      })
      .catch(() => {
        setGrifes([]);
        setSemGrife(0);
      });
  }, [loadLastSync]);

  async function handleSyncSheets() {
    setSyncing(true);
    try {
      const result = await syncCertSheets();
      const synced = Number((result.sheets as { synced?: number } | undefined)?.synced ?? 0);
      await Promise.all([loadProducts(), loadLastSync()]);
      if (!result.locked) {
        toast.error('Outra sincronização está em andamento. Aguarde e consulte a última execução.');
      } else if (
        result.status === 'error' ||
        result.error ||
        result.sheets?.error ||
        result.linx?.error ||
        Number(result.linx?.errors ?? 0) > 0
      ) {
        toast.error(
          result.error || 'Sincronização incompleta: confira os erros da planilha e do Linx.',
        );
      } else {
        toast.success(`Planilha sincronizada: ${synced} produto(s).`);
      }
    } catch (err) {
      // Mensagem do backend preservada: 409 (já há um sync rodando) e 403 (sem
      // permissão) precisam chegar ao operador com o motivo real.
      toast.error(getErrorMessage(err));
      // A execução que falhou também fica registrada: sem recarregar, o aviso
      // da última sincronização continuaria mostrando a tentativa anterior.
      await loadLastSync();
    } finally {
      setSyncing(false);
    }
  }

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
    setGrife('');
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
    grife ||
    search ||
    startDate ||
    endDate;

  return (
    <div className="space-y-5 animate-fade-in">
      {lastSync?.error && (
        <div
          role="alert"
          className="rounded-2xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-700/50 dark:bg-danger-950/30 dark:text-danger-300"
        >
          <p className="font-semibold">
            A última sincronização ({formatDateTime(lastSync.started_at)}) falhou — {lastSync.error}
            .{syncCause ? ` Motivo: ${syncCause}.` : ''}
          </p>
          <p className="mt-1 text-xs">
            Os produtos exibem os últimos dados salvos; esta tentativa não confirmou a atualização
            das fontes.
            {!linxWasRead(lastSync) &&
              ' Licenciamento, grife e fim de vendas do Linx também não foram lidos.'}
          </p>
        </div>
      )}

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

          {/* Grife / licença — vem do Linx (PRODUTOS.GRIFFE na Puket,
              IMG_LICENCIAMENTO na Imaginarium). A cobertura é parcial, então o
              rótulo diz quantos produtos ainda não têm o campo preenchido: sem
              isso a lista filtrada pareceria "a marca não tem esses itens". */}
          {grifes.length > 0 && (
            <div className="flex w-full min-w-0 flex-col gap-1.5 sm:w-auto">
              <label
                htmlFor="cert-products-grife"
                className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400"
              >
                Grife / licença
              </label>
              <select
                id="cert-products-grife"
                value={grife}
                onChange={(e) => {
                  setGrife(e.target.value);
                  setPage(1);
                }}
                className="w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-emerald-500 focus:outline-none sm:w-56 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
              >
                <option value="">Todas as grifes</option>
                {grifes.map((g) => (
                  <option key={g.grife} value={g.grife}>
                    {g.grife} ({g.count})
                  </option>
                ))}
              </select>
              {semGrife > 0 && (
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  {semGrife} produto{semGrife !== 1 ? 's' : ''} sem grife preenchida no Linx
                </span>
              )}
            </div>
          )}
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
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            {/* "Atualizar" só relê o banco. Forçar a leitura da PLANILHA não
                tinha botão: a única forma era rodar a validação inteira, que
                consulta a VTEX de 674 produtos (~17 min). */}
            <button
              type="button"
              onClick={handleSyncSheets}
              disabled={syncing}
              title="Lê a planilha do time fiscal e os atributos do Linx (não roda a validação da VTEX)"
              className="flex min-h-9 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-1.5 text-xs font-semibold text-emerald-700 transition-all hover:bg-emerald-100 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/50"
            >
              <DownloadCloud className={cn('h-3.5 w-3.5', syncing && 'animate-pulse')} />
              {syncing ? 'Sincronizando…' : 'Sincronizar planilha agora'}
            </button>
            <button
              type="button"
              onClick={loadProducts}
              disabled={loading}
              className="flex min-h-9 items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 active:scale-[0.98] transition-all"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
              Atualizar
            </button>
          </div>
        </div>

        {lastSync && (
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Última sincronização da planilha: {formatDateTime(lastSync.started_at)}
            {lastSync.actor
              ? ` por ${lastSync.actor}`
              : ` (${SYNC_TRIGGER_LABEL[lastSync.trigger]})`}
            {lastSync.error && (
              <span className="ml-2 font-medium text-danger-600 dark:text-danger-300">
                falhou — veja o aviso no topo da página.
              </span>
            )}
            {!lastSync.error && syncPendencias.total > 0 && (
              <span className="mt-1 block font-medium text-amber-700 dark:text-amber-400">
                {syncPendencias.total} SKU(s) sincronizado(s) com vínculo de certificado a conferir
                na planilha: {syncPendencias.skus.join(', ')}
                {syncPendencias.total > syncPendencias.skus.length ? '…' : ''}
              </span>
            )}
            {!lastSync.finished_at && !lastSync.error && (
              <span className="ml-2 text-amber-600 dark:text-amber-400">em andamento…</span>
            )}
          </p>
        )}
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
            {licenseFilterWithoutLinx ? (
              <div className="mt-2 max-w-md text-center">
                <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                  O licenciamento ainda não foi lido do Linx, então este resultado vazio não
                  significa que não existam produtos nesse status. Até a leitura acontecer, todos
                  aparecem como “Pendente”.
                </p>
                <button
                  type="button"
                  onClick={() => handleStatusFilterChange('license_status', 'PENDENTE')}
                  className="mt-3 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-50 dark:border-amber-700 dark:bg-slate-800 dark:text-amber-400"
                >
                  Ver licenciamento pendente
                </button>
              </div>
            ) : (
              <p className="text-xs mt-1 text-slate-500 dark:text-slate-400">
                Ajuste os filtros ou busca
              </p>
            )}
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
                    Nº Certificado
                  </th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Status Certificacao
                  </th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Validade do certificado
                  </th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Situação da venda
                  </th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Fim de venda por certificação
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
                      {/* Nº do certificado (coluna P das abas). Alguns produtos
                          trazem DOIS números separados por quebra de linha
                          (recertificação) — cada um vira uma linha, e o título
                          mostra o valor inteiro quando a coluna trunca. */}
                      <td className="max-w-[190px] px-5 py-3.5">
                        <CertificateNumberCell value={p.numero_certificado} />
                      </td>
                      <td className="px-5 py-3.5">
                        {p.cert_status ? (
                          <div>
                            <CertStatusBadge status={p.cert_status} />
                            {p.cert_status_reason && (
                              <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                                {p.cert_status_reason}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-300 font-medium">--</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-xs whitespace-nowrap">
                        {formatDate(p.validade_certificado)}
                      </td>
                      <td className="px-5 py-3.5">
                        <CertStatusBadge
                          status={p.status_venda_reason ? 'PENDENTE' : p.status_venda || 'PENDENTE'}
                        />
                        {p.status_venda_reason && (
                          <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                            {p.status_venda_reason}
                          </p>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
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
                          <div>
                            <CertStatusBadge status={p.license_status} />
                            {p.license_status_reason && (
                              <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                                {p.license_status_reason}
                              </p>
                            )}
                          </div>
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
