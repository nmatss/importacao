import { useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Bell,
  AlertTriangle,
  Info,
  CheckCircle2,
  Shield,
  Clock,
  ExternalLink,
  FileDown,
} from 'lucide-react';
import { useApiQuery } from '@/shared/hooks/useApi';
import { api } from '@/shared/lib/api-client';
import { formatDate, cn } from '@/shared/lib/utils';
import { downloadCsv } from '@/shared/lib/csv';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { DateRangeFilter } from '@/shared/components/DateRangeFilter';
import { getErrorMessage } from '@/shared/utils/errors';

interface Alert {
  id: number;
  processId: number | null;
  processCode: string | null;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  sentToChat: boolean;
  sentAt: string | null;
  acknowledged: boolean;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
}

type AckResponse = Alert;
type PaginatedAlerts = {
  data: Alert[];
  pagination: { page: number; limit: number; total: number; pages: number };
};

const severityConfig = {
  info: {
    icon: Info,
    dot: 'bg-primary-500',
    bar: 'bg-primary-500',
    badgeBg: 'bg-primary-50',
    badgeText: 'text-primary-700',
    iconColor: 'text-primary-600',
    iconBg: 'bg-primary-50',
    label: 'Informativo',
  },
  warning: {
    icon: AlertTriangle,
    dot: 'bg-amber-500',
    bar: 'bg-amber-500',
    badgeBg: 'bg-amber-50',
    badgeText: 'text-amber-700',
    iconColor: 'text-amber-600',
    iconBg: 'bg-amber-50',
    label: 'Atenção',
  },
  critical: {
    icon: AlertTriangle,
    dot: 'bg-danger-500',
    bar: 'bg-danger-500',
    badgeBg: 'bg-danger-50',
    badgeText: 'text-danger-700',
    iconColor: 'text-danger-600',
    iconBg: 'bg-danger-50',
    label: 'Crítico',
  },
} as const;

type SeverityFilter = 'all' | 'info' | 'warning' | 'critical';
type AckFilter = 'all' | 'true' | 'false';

const severityOptions: { value: SeverityFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'critical', label: 'Crítico' },
  { value: 'warning', label: 'Atenção' },
  { value: 'info', label: 'Informativo' },
];

const ackOptions: { value: AckFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'false', label: 'Pendentes' },
  { value: 'true', label: 'Tratados' },
];

export function AlertsPage() {
  const queryClient = useQueryClient();
  const [severityFilter, setSeverityFilterRaw] = useState<SeverityFilter>('all');
  const [ackFilter, setAckFilterRaw] = useState<AckFilter>('all');
  const [startDate, setStartDateRaw] = useState('');
  const [endDate, setEndDateRaw] = useState('');
  const [page, setPage] = useState(1);
  // Mudar qualquer filtro volta para a página 1.
  const setSeverityFilter = (v: SeverityFilter) => {
    setSeverityFilterRaw(v);
    setPage(1);
  };
  const setAckFilter = (v: AckFilter) => {
    setAckFilterRaw(v);
    setPage(1);
  };
  const setStartDate = (v: string) => {
    setStartDateRaw(v);
    setPage(1);
  };
  const setEndDate = (v: string) => {
    setEndDateRaw(v);
    setPage(1);
  };
  const [exportingCsv, setExportingCsv] = useState(false);

  const queryParams = new URLSearchParams();
  // Auditoria 2026-07-17: limit=100 sem paginação escondia alertas 101+ para
  // sempre — a API sempre foi paginada, só a tela não usava.
  queryParams.set('limit', '50');
  queryParams.set('page', String(page));
  if (severityFilter !== 'all') queryParams.set('severity', severityFilter);
  if (ackFilter !== 'all') queryParams.set('acknowledged', ackFilter);
  if (startDate) queryParams.set('startDate', startDate);
  if (endDate) queryParams.set('endDate', endDate);
  const qs = queryParams.toString();

  const {
    data: alertsResponse,
    isLoading,
    error,
    refetch,
  } = useApiQuery<{
    data: Alert[];
    pagination?: { total?: number; pages?: number; page?: number };
  }>(['alerts', severityFilter, ackFilter, startDate, endDate, page], `/api/alerts?${qs}`);
  const alerts = alertsResponse?.data;
  const totalAlerts = alertsResponse?.pagination?.total ?? alerts?.length ?? 0;
  // sendPaginated retorna `pages` (não `totalPages`) — mesmo campo que o
  // export CSV já lia.
  const totalPages = alertsResponse?.pagination?.pages ?? 1;
  // Contagem de pendentes: com paginação, contar só a página subestima. Quando
  // o filtro já é "pendentes", o total da API é exato; senão, aproxima pela página.
  const pendingCount =
    ackFilter === 'false' ? totalAlerts : (alerts?.filter((a) => !a.acknowledged).length ?? 0);

  const handleAcknowledge = async (alertId: number) => {
    try {
      await api.patch<AckResponse>(`/api/alerts/${alertId}/acknowledge`);
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      toast.success('Alerta marcado como tratado');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    }
  };

  const handleExportCsv = async () => {
    setExportingCsv(true);
    try {
      const rows: Alert[] = [];
      let page = 1;
      let pages = 1;

      do {
        const exportParams = new URLSearchParams(queryParams);
        exportParams.set('page', String(page));
        exportParams.set('limit', '100');
        const response = await api.get<PaginatedAlerts>(`/api/alerts?${exportParams.toString()}`);
        rows.push(...response.data);
        pages = response.pagination.pages || 1;
        page += 1;
      } while (page <= pages);

      if (!rows.length) {
        toast.error('Nenhum alerta para exportar com os filtros atuais.');
        return;
      }

      downloadCsv('alertas-importacao.csv', [
        [
          'ID',
          'Processo',
          'Severidade',
          'Titulo',
          'Mensagem',
          'Status',
          'Criado em',
          'Tratado em',
          'Tratado por',
        ],
        ...rows.map((alert) => [
          alert.id,
          alert.processCode || alert.processId || '',
          severityConfig[alert.severity].label,
          alert.title,
          alert.message,
          alert.acknowledged ? 'Tratado' : 'Pendente',
          alert.createdAt,
          alert.acknowledgedAt || '',
          alert.acknowledgedBy || '',
        ]),
      ]);
      toast.success(`Relatório de alertas exportado em CSV (${rows.length} registros).`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setExportingCsv(false);
    }
  };

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Page Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Central de Alertas
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Acompanhe riscos, prazos e automações que exigem ação.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={exportingCsv || !alerts?.length}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-all hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-900"
          >
            <FileDown className="h-4 w-4" />
            {exportingCsv ? 'Exportando...' : 'Exportar CSV'}
          </button>
          {pendingCount > 0 && (
            <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-4 py-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
              </span>
              <span className="text-sm font-semibold text-amber-700">
                {pendingCount} pendente{pendingCount !== 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Filter Pills */}
      <div className="rounded-2xl border border-slate-200/80 bg-white dark:bg-slate-800 dark:border-slate-700/80 p-3 sm:p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-4 sm:gap-6">
          {/* Severity Filter */}
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">
              Severidade
            </p>
            <div className="flex items-center gap-1.5">
              {severityOptions.map((opt) => (
                <button
                  type="button"
                  key={opt.value}
                  aria-pressed={severityFilter === opt.value}
                  onClick={() => setSeverityFilter(opt.value)}
                  className={cn(
                    'rounded-lg px-3.5 py-1.5 text-sm font-medium transition-all',
                    severityFilter === opt.value
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-200',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Divider */}
          <div className="hidden h-8 w-px bg-slate-200 dark:bg-slate-700 sm:block" />

          {/* Date Range Filter */}
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">
              Período
            </p>
            <DateRangeFilter
              startDate={startDate}
              endDate={endDate}
              onStartDateChange={setStartDate}
              onEndDateChange={setEndDate}
              label="Período"
              showLabel={false}
            />
          </div>

          {/* Divider */}
          <div className="hidden h-8 w-px bg-slate-200 dark:bg-slate-700 sm:block" />

          {/* Ack Filter */}
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">
              Status
            </p>
            <div className="flex items-center gap-1.5">
              {ackOptions.map((opt) => (
                <button
                  type="button"
                  key={opt.value}
                  aria-pressed={ackFilter === opt.value}
                  onClick={() => setAckFilter(opt.value)}
                  className={cn(
                    'rounded-lg px-3.5 py-1.5 text-sm font-medium transition-all',
                    ackFilter === opt.value
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-200',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Alerts List */}
      <div className="rounded-2xl border border-slate-200/80 bg-white dark:bg-slate-800 dark:border-slate-700/80 shadow-sm overflow-hidden">
        <div className="border-b border-slate-100 dark:border-slate-700 px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2.5 text-sm sm:text-base font-semibold text-slate-900 dark:text-slate-100">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-700">
                <Shield className="h-4 w-4 text-slate-600 dark:text-slate-400" />
              </div>
              Alertas encontrados
            </h3>
            {alerts?.length ? (
              <span className="rounded-full bg-slate-100 dark:bg-slate-700 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-400">
                {alerts.length} alerta{alerts.length !== 1 ? 's' : ''}
              </span>
            ) : null}
          </div>
        </div>

        {error ? (
          <ErrorState message="Erro ao carregar alertas." onRetry={() => refetch()} />
        ) : isLoading ? (
          <LoadingSpinner className="py-12" />
        ) : !alerts?.length ? (
          <EmptyState
            icon={Bell}
            title="Nenhum alerta"
            description="Nenhum alerta encontrado com os filtros selecionados."
          />
        ) : (
          <div>
            {alerts.map((alert) => {
              const config = severityConfig[alert.severity];
              const SeverityIcon = config.icon;

              return (
                <div
                  key={alert.id}
                  className={cn(
                    'relative border-b border-slate-100 dark:border-slate-700 last:border-b-0 transition-colors',
                    alert.acknowledged
                      ? 'bg-slate-50/50 dark:bg-slate-900/50'
                      : 'bg-white dark:bg-slate-800',
                  )}
                >
                  {/* Severity bar on left */}
                  <div className={cn('absolute left-0 top-0 bottom-0 w-1', config.bar)} />

                  <div className="flex items-start gap-3 sm:gap-4 px-4 sm:px-6 py-4 sm:py-5 pl-5 sm:pl-7">
                    {/* Severity icon */}
                    <div
                      className={cn(
                        'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                        config.iconBg,
                      )}
                    >
                      <SeverityIcon className={cn('h-4.5 w-4.5', config.iconColor)} />
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {alert.title}
                        </span>
                        <span
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
                            config.badgeBg,
                            config.badgeText,
                          )}
                        >
                          <span className={cn('h-1.5 w-1.5 rounded-full', config.dot)} />
                          {config.label}
                        </span>
                        {alert.acknowledged && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                            <CheckCircle2 className="h-3 w-3" />
                            Tratado
                          </span>
                        )}
                      </div>

                      <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                        {alert.message}
                      </p>

                      {alert.processId && (
                        <Link
                          to={`/importacao/processos/${alert.processId}`}
                          className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700 transition-colors"
                        >
                          <ExternalLink className="h-3 w-3" />
                          {alert.processCode || alert.processId}
                        </Link>
                      )}

                      <div className="mt-2.5 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDate(alert.createdAt)}
                        </span>
                        {alert.acknowledgedAt && (
                          <span>
                            Tratado em {formatDate(alert.acknowledgedAt)}
                            {alert.acknowledgedBy && ` por ${alert.acknowledgedBy}`}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Action */}
                    {!alert.acknowledged && (
                      <button
                        type="button"
                        onClick={() => handleAcknowledge(alert.id)}
                        className="shrink-0 inline-flex items-center gap-1.5 sm:gap-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-900 hover:border-slate-300 transition-all"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        <span className="hidden sm:inline">Marcar tratado</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 dark:border-slate-700 sm:px-6">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Página {page} de {totalPages} · {totalAlerts} alerta{totalAlerts !== 1 ? 's' : ''}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    Próxima
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
