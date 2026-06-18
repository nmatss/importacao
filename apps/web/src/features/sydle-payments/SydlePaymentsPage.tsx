import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Filter,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  Settings,
  Unlink,
  X,
} from 'lucide-react';
import { api } from '@/shared/lib/api-client';
import { useApiQuery } from '@/shared/hooks/useApi';
import { useAuth } from '@/shared/hooks/useAuth';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import { cn, formatCurrency, formatDateTime } from '@/shared/lib/utils';
import { getErrorMessage } from '@/shared/utils/errors';

const REFRESH_INTERVAL_MS = 15 * 60 * 1000;

type PaymentStatus = 'open' | 'scheduled' | 'paid' | 'overdue' | 'cancelled' | 'unknown';
type PaymentType = 'deposit' | 'balance' | 'fee' | 'refund' | 'other';
type MatchStatus = 'matched' | 'ambiguous' | 'unmatched';

interface SydlePayment {
  id: number;
  externalId: string;
  processId: number | null;
  matchStatus: MatchStatus;
  matchScore: string | null;
  matchReason: string | null;
  processCode: string | null;
  purchaseRef: string | null;
  purchaseOrder: string | null;
  proformaNumber: string | null;
  invoiceNumber: string | null;
  supplierName: string | null;
  brand: string | null;
  currency: string;
  purchaseAmount: string | null;
  paidAmount: string | null;
  openAmount: string | null;
  paymentType: PaymentType;
  paymentStatus: PaymentStatus;
  dueDate: string | null;
  paidAt: string | null;
  scheduledAt: string | null;
  exchangeRate: string | null;
  amountBrl: string | null;
  bankName: string | null;
  contractNumber: string | null;
  remittanceId: string | null;
  sourceUpdatedAt: string | null;
  syncedAt: string;
  portalProcessCode: string | null;
  portalBrand: string | null;
}

interface PaginatedResponse {
  data: SydlePayment[];
  pagination: { total: number; page: number; limit: number; pages: number };
}

interface SyncRun {
  id: number;
  status: string;
  trigger: string;
  startedAt: string;
  completedAt: string | null;
  duration: number | null;
  fetched: number | null;
  created: number | null;
  updated: number | null;
  matched: number | null;
  unmatched: number | null;
  errors: number | null;
  errorMessage: string | null;
  metadata: Record<string, unknown> | null;
}

interface SydleSummary {
  totalPurchaseUsd: number;
  totalPaidUsd: number;
  totalOpenUsd: number;
  totalBrl: number;
  records: number;
  matched: number;
  unmatched: number;
  overdue: number;
  dueSoon: number;
  paid: number;
  config: {
    enabled: boolean;
    configured: boolean;
    missing: string[];
    paymentsPath: string;
    pageSize: number;
  };
  lastRun: SyncRun | null;
}

const paymentStatusLabels: Record<PaymentStatus, string> = {
  open: 'Aberto',
  scheduled: 'Agendado',
  paid: 'Pago',
  overdue: 'Vencido',
  cancelled: 'Cancelado',
  unknown: 'Indefinido',
};

const paymentTypeLabels: Record<PaymentType, string> = {
  deposit: 'Sinal',
  balance: 'Saldo',
  fee: 'Taxa',
  refund: 'Estorno',
  other: 'Outro',
};

const matchLabels: Record<MatchStatus, string> = {
  matched: 'Conciliado',
  ambiguous: 'Ambíguo',
  unmatched: 'Sem vínculo',
};

function compactCurrency(value: number, currency = 'USD'): string {
  if (!Number.isFinite(value)) return formatCurrency(0, currency);
  if (Math.abs(value) >= 1_000_000) return `${currency} ${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${currency} ${(value / 1_000).toFixed(1)}K`;
  return formatCurrency(value, currency);
}

function money(value: string | number | null, currency = 'USD'): string {
  if (value === null || value === undefined || value === '') return '--';
  const numeric = Number(value);
  return Number.isFinite(numeric) ? formatCurrency(numeric, currency) : '--';
}

function dateLabel(value: string | null): string {
  if (!value) return '--';
  return new Date(value).toLocaleDateString('pt-BR');
}

function statusClass(status: PaymentStatus): string {
  switch (status) {
    case 'paid':
      return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/70';
    case 'overdue':
      return 'bg-danger-50 text-danger-700 ring-1 ring-danger-200/70';
    case 'scheduled':
      return 'bg-primary-50 text-primary-700 ring-1 ring-primary-200/70';
    case 'cancelled':
      return 'bg-slate-100 text-slate-600 ring-1 ring-slate-200/70';
    case 'open':
      return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200/70';
    default:
      return 'bg-slate-100 text-slate-600 ring-1 ring-slate-200/70';
  }
}

function matchClass(status: MatchStatus): string {
  switch (status) {
    case 'matched':
      return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/70';
    case 'ambiguous':
      return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200/70';
    default:
      return 'bg-danger-50 text-danger-700 ring-1 ring-danger-200/70';
  }
}

function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold',
        className,
      )}
    >
      {children}
    </span>
  );
}

function KpiCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string | number;
  icon: typeof Banknote;
  tone: 'blue' | 'green' | 'amber' | 'red' | 'slate';
}) {
  const toneClass = {
    blue: 'bg-primary-50 text-primary-700 ring-primary-200/70',
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-200/70',
    amber: 'bg-amber-50 text-amber-700 ring-amber-200/70',
    red: 'bg-danger-50 text-danger-700 ring-danger-200/70',
    slate: 'bg-slate-100 text-slate-700 ring-slate-200/70',
  }[tone];

  return (
    <div className="rounded-lg border border-slate-200/70 bg-white p-4 shadow-sm dark:border-slate-700/70 dark:bg-slate-800">
      <div className="flex items-center gap-3 min-w-0">
        <span
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1',
            toneClass,
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
          <p className="truncate text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {value}
          </p>
        </div>
      </div>
    </div>
  );
}

export function SydlePaymentsPage() {
  const queryClient = useQueryClient();
  const { user, getToken } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [supplier, setSupplier] = useState('');
  const [brand, setBrand] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [paymentType, setPaymentType] = useState('');
  const [matchStatus, setMatchStatus] = useState('');
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const limit = 50;

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', String(limit));
    if (search) params.set('search', search);
    if (supplier) params.set('supplier', supplier);
    if (brand) params.set('brand', brand);
    if (paymentStatus) params.set('paymentStatus', paymentStatus);
    if (paymentType) params.set('paymentType', paymentType);
    if (matchStatus) params.set('matchStatus', matchStatus);
    if (dueFrom) params.set('dueFrom', dueFrom);
    if (dueTo) params.set('dueTo', dueTo);
    return params;
  }, [brand, dueFrom, dueTo, matchStatus, page, paymentStatus, paymentType, search, supplier]);

  const summaryParams = useMemo(() => {
    const params = new URLSearchParams(queryParams);
    params.delete('page');
    params.delete('limit');
    return params;
  }, [queryParams]);

  const reportUrl = `/api/sydle/payments-report?${queryParams.toString()}`;
  const summaryUrl = `/api/sydle/payments-report/summary?${summaryParams.toString()}`;

  const {
    data: report,
    isLoading,
    error,
    refetch,
  } = useApiQuery<PaginatedResponse>(['sydle-payments', queryParams.toString()], reportUrl, {
    refetchInterval: REFRESH_INTERVAL_MS,
  });

  const { data: summary } = useApiQuery<SydleSummary>(
    ['sydle-payments-summary', summaryParams.toString()],
    summaryUrl,
    { refetchInterval: REFRESH_INTERVAL_MS },
  );

  const { data: syncRuns } = useApiQuery<SyncRun[]>(
    ['sydle-sync-runs'],
    '/api/sydle/sync-runs?limit=5',
    { refetchInterval: REFRESH_INTERVAL_MS },
  );

  const rows = report?.data ?? [];
  const pagination = report?.pagination;
  const hasFilters =
    search || supplier || brand || paymentStatus || paymentType || matchStatus || dueFrom || dueTo;

  function resetPageAnd(setter: (value: string) => void, value: string) {
    setter(value);
    setPage(1);
  }

  function clearFilters() {
    setSearch('');
    setSupplier('');
    setBrand('');
    setPaymentStatus('');
    setPaymentType('');
    setMatchStatus('');
    setDueFrom('');
    setDueTo('');
    setPage(1);
  }

  async function handleSyncNow() {
    setSyncing(true);
    try {
      const result = await api.post<SyncRun>('/api/sydle/sync-now');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['sydle-payments'] }),
        queryClient.invalidateQueries({ queryKey: ['sydle-payments-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['sydle-sync-runs'] }),
      ]);
      toast.success(
        result.status === 'skipped'
          ? 'Sincronização SYDLE ignorada: configuração pendente.'
          : 'Sincronização SYDLE concluída.',
      );
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setSyncing(false);
    }
  }

  async function handleExportCsv() {
    setExporting(true);
    try {
      const params = new URLSearchParams(summaryParams);
      const baseUrl = import.meta.env.VITE_API_URL || '';
      const response = await fetch(
        `${baseUrl}/api/sydle/payments-report/export.csv?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${getToken() ?? ''}`,
          },
        },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `sydle-compras-pagamentos-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success('Relatório SYDLE exportado em CSV.');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setExporting(false);
    }
  }

  if (isLoading && !report) {
    return <LoadingSpinner className="py-24" size="lg" />;
  }

  if (error) {
    return <ErrorState message="Erro ao carregar relatório SYDLE." onRetry={() => refetch()} />;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50 text-primary-700 ring-1 ring-primary-200/70">
              <Banknote className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                Compras e Pagamentos Internacionais
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Relatório financeiro sincronizado da SYDLE a cada 15 minutos.
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={exporting || !rows.length}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {exporting ? 'Exportando' : 'CSV'}
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={handleSyncNow}
              disabled={syncing}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 disabled:opacity-50"
            >
              {syncing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {syncing ? 'Sincronizando' : 'Sincronizar'}
            </button>
          )}
        </div>
      </div>

      {summary && !summary.config.configured && (
        <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Settings className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">Integração SYDLE aguardando configuração</p>
              <p className="mt-0.5">
                Pendentes: {summary.config.missing.join(', ') || 'contrato da SYDLE'}.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <KpiCard
          label="Comprado USD"
          value={compactCurrency(summary?.totalPurchaseUsd ?? 0)}
          icon={Banknote}
          tone="blue"
        />
        <KpiCard
          label="Pago USD"
          value={compactCurrency(summary?.totalPaidUsd ?? 0)}
          icon={CheckCircle2}
          tone="green"
        />
        <KpiCard
          label="Aberto USD"
          value={compactCurrency(summary?.totalOpenUsd ?? 0)}
          icon={CalendarClock}
          tone="amber"
        />
        <KpiCard
          label="Vencidos"
          value={summary?.overdue ?? 0}
          icon={AlertTriangle}
          tone={(summary?.overdue ?? 0) > 0 ? 'red' : 'slate'}
        />
        <KpiCard
          label="Conciliados"
          value={`${summary?.matched ?? 0}/${summary?.records ?? 0}`}
          icon={Link2}
          tone="green"
        />
        <KpiCard
          label="Abertos 7 dias"
          value={summary?.dueSoon ?? 0}
          icon={CalendarClock}
          tone="amber"
        />
      </div>

      <div className="rounded-lg border border-slate-200/70 bg-white p-4 shadow-sm dark:border-slate-700/70 dark:bg-slate-800">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
          <Filter className="h-4 w-4" />
          Filtros
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-8">
          <label className="xl:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-500">Busca</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => resetPageAnd(setSearch, event.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-700 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                placeholder="Processo, compra, PI, invoice..."
              />
            </div>
          </label>
          <label className="xl:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-500">Fornecedor</span>
            <input
              value={supplier}
              onChange={(event) => resetPageAnd(setSupplier, event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              placeholder="Nome do fornecedor"
            />
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-slate-500">Marca</span>
            <select
              value={brand}
              onChange={(event) => resetPageAnd(setBrand, event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              <option value="">Todas</option>
              <option value="puket">Puket</option>
              <option value="imaginarium">Imaginarium</option>
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-slate-500">Status</span>
            <select
              value={paymentStatus}
              onChange={(event) => resetPageAnd(setPaymentStatus, event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              <option value="">Todos</option>
              {Object.entries(paymentStatusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-slate-500">Tipo</span>
            <select
              value={paymentType}
              onChange={(event) => resetPageAnd(setPaymentType, event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              <option value="">Todos</option>
              {Object.entries(paymentTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-slate-500">Conciliação</span>
            <select
              value={matchStatus}
              onChange={(event) => resetPageAnd(setMatchStatus, event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              <option value="">Todas</option>
              {Object.entries(matchLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-slate-500">Venc. início</span>
            <input
              type="date"
              value={dueFrom}
              onChange={(event) => resetPageAnd(setDueFrom, event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            />
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-slate-500">Venc. fim</span>
            <input
              type="date"
              value={dueTo}
              onChange={(event) => resetPageAnd(setDueTo, event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            />
          </label>
        </div>
        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="mt-3 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-primary-700 hover:bg-primary-50 dark:text-primary-300 dark:hover:bg-primary-950/30"
          >
            <X className="h-4 w-4" />
            Limpar filtros
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-slate-200/70 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm dark:border-slate-700/70 dark:bg-slate-800 dark:text-slate-300 sm:flex-row sm:items-center sm:justify-between">
        <span>
          Última sync:{' '}
          <strong className="text-slate-900 dark:text-slate-100">
            {summary?.lastRun?.startedAt
              ? formatDateTime(summary.lastRun.startedAt)
              : 'sem execução'}
          </strong>
        </span>
        <span>
          Status:{' '}
          <strong className="text-slate-900 dark:text-slate-100">
            {summary?.lastRun?.status ?? 'sem dados'}
          </strong>
        </span>
      </div>

      {!rows.length ? (
        <EmptyState
          icon={Unlink}
          title="Nenhum pagamento SYDLE encontrado"
          description={
            hasFilters
              ? 'Nenhum registro atende aos filtros atuais.'
              : 'A sincronização ainda não trouxe dados ou a integração está aguardando configuração.'
          }
        />
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-lg border border-slate-200/70 bg-white shadow-sm dark:border-slate-700/70 dark:bg-slate-800 md:block">
            <div className="overflow-x-auto">
              <table className="min-w-[1280px] w-full divide-y divide-slate-200 dark:divide-slate-700">
                <thead className="bg-slate-50 dark:bg-slate-900">
                  <tr>
                    {[
                      'Processo',
                      'Compra',
                      'Fornecedor',
                      'Tipo',
                      'Status',
                      'Valor',
                      'Pago',
                      'Saldo',
                      'Vencimento',
                      'Conciliação',
                      'Atualização',
                    ].map((label) => (
                      <th
                        key={label}
                        className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {rows.map((row) => {
                    const processCode = row.portalProcessCode || row.processCode;
                    return (
                      <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                        <td className="px-4 py-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {row.processId ? (
                            <Link
                              to={`/importacao/processos/${row.processId}`}
                              className="inline-flex items-center gap-1.5 text-primary-700 hover:underline dark:text-primary-300"
                            >
                              {processCode}
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Link>
                          ) : (
                            processCode || '--'
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300">
                          <div className="font-medium">
                            {row.purchaseRef || row.purchaseOrder || '--'}
                          </div>
                          <div className="text-xs text-slate-400">
                            PI {row.proformaNumber || '--'} · INV {row.invoiceNumber || '--'}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300">
                          <div className="max-w-[260px] truncate">{row.supplierName || '--'}</div>
                          <div className="text-xs uppercase text-slate-400">
                            {row.brand || row.portalBrand || '--'}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300">
                          {paymentTypeLabels[row.paymentType]}
                        </td>
                        <td className="px-4 py-3">
                          <Badge className={statusClass(row.paymentStatus)}>
                            {paymentStatusLabels[row.paymentStatus]}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                          {money(row.purchaseAmount, row.currency)}
                        </td>
                        <td className="px-4 py-3 text-sm tabular-nums text-slate-700 dark:text-slate-300">
                          {money(row.paidAmount, row.currency)}
                        </td>
                        <td className="px-4 py-3 text-sm tabular-nums text-slate-700 dark:text-slate-300">
                          {money(row.openAmount, row.currency)}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300">
                          {dateLabel(row.dueDate)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge className={matchClass(row.matchStatus)}>
                            {matchLabels[row.matchStatus]}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                          <div>
                            SYDLE {row.sourceUpdatedAt ? formatDateTime(row.sourceUpdatedAt) : '--'}
                          </div>
                          <div>Portal {row.syncedAt ? formatDateTime(row.syncedAt) : '--'}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-3 md:hidden">
            {rows.map((row) => {
              const processCode = row.portalProcessCode || row.processCode;
              return (
                <div
                  key={row.id}
                  className="rounded-lg border border-slate-200/70 bg-white p-4 shadow-sm dark:border-slate-700/70 dark:bg-slate-800"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">
                        {processCode || row.purchaseRef || row.externalId}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {row.supplierName || '--'}
                      </p>
                    </div>
                    <Badge className={statusClass(row.paymentStatus)}>
                      {paymentStatusLabels[row.paymentStatus]}
                    </Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="block text-xs text-slate-500">Compra</span>
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {row.purchaseRef || row.purchaseOrder || '--'}
                      </span>
                    </div>
                    <div>
                      <span className="block text-xs text-slate-500">Tipo</span>
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {paymentTypeLabels[row.paymentType]}
                      </span>
                    </div>
                    <div>
                      <span className="block text-xs text-slate-500">Valor</span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {money(row.purchaseAmount, row.currency)}
                      </span>
                    </div>
                    <div>
                      <span className="block text-xs text-slate-500">Saldo</span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {money(row.openAmount, row.currency)}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <Badge className={matchClass(row.matchStatus)}>
                      {matchLabels[row.matchStatus]}
                    </Badge>
                    {row.processId && (
                      <Link
                        to={`/importacao/processos/${row.processId}`}
                        className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-700 dark:text-primary-300"
                      >
                        Abrir processo
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {pagination && pagination.pages > 1 && (
        <div className="flex items-center justify-between rounded-lg border border-slate-200/70 bg-white px-4 py-3 text-sm shadow-sm dark:border-slate-700/70 dark:bg-slate-800">
          <span className="text-slate-500">
            Página {pagination.page} de {pagination.pages} · {pagination.total} registros
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"
            >
              <ChevronLeft className="h-4 w-4" />
              Anterior
            </button>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(pagination.pages, current + 1))}
              disabled={page >= pagination.pages}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"
            >
              Próxima
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {syncRuns?.length ? (
        <div className="rounded-lg border border-slate-200/70 bg-white p-4 shadow-sm dark:border-slate-700/70 dark:bg-slate-800">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Histórico recente de sync
          </h3>
          <div className="mt-3 grid gap-2">
            {syncRuns.map((run) => (
              <div
                key={run.id}
                className="flex flex-col gap-1 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="font-medium text-slate-800 dark:text-slate-200">
                  #{run.id} · {run.status} · {formatDateTime(run.startedAt)}
                </span>
                <span className="text-xs text-slate-500">
                  {run.fetched ?? 0} lidos · {run.created ?? 0} novos · {run.updated ?? 0}{' '}
                  atualizados · {run.errors ?? 0} erros
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
