import { useState, Fragment } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Inbox,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  AlertCircle,
  Wifi,
  WifiOff,
  Mail,
  CheckCircle2,
  XCircle,
  Clock,
  Paperclip,
  RotateCcw,
  ExternalLink,
} from 'lucide-react';
import { useApiQuery } from '@/shared/hooks/useApi';
import { cn } from '@/shared/lib/utils';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import { EmptyState } from '@/shared/components/EmptyState';
import { DateRangeFilter } from '@/shared/components/DateRangeFilter';
import { api } from '@/shared/lib/api-client';

interface AttachmentDetail {
  filename: string;
  type: string;
  documentId: string | null;
}

interface EmailLog {
  id: number;
  messageId: string;
  fromAddress: string;
  subject: string;
  receivedAt: string;
  processId: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'ignored' | 'reprocessed';
  attachmentsCount: number;
  processedAttachments: number;
  processedAttachmentDetails?: AttachmentDetail[];
  errorMessage: string | null;
  processCode: string | null;
  createdAt: string;
}

interface EmailStatus {
  enabled: boolean;
  method: 'gmail_api' | 'imap' | 'none';
  gmailConfigured: boolean;
  imapConfigured: boolean;
  sharedMailbox: string | null;
  allowedSenders: string;
  lastRun: string | null;
  todayStats: { status: string; count: number }[];
}

interface LogsResponse {
  data: EmailLog[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

interface TriggerResponse {
  success: boolean;
  data: { message: string };
}

const statusBadgeConfig: Record<string, { dot: string; bg: string; text: string; label: string }> =
  {
    completed: {
      dot: 'bg-emerald-500',
      bg: 'bg-emerald-50',
      text: 'text-emerald-700',
      label: 'Concluido',
    },
    failed: { dot: 'bg-danger-500', bg: 'bg-danger-50', text: 'text-danger-700', label: 'Falha' },
    processing: {
      dot: 'bg-primary-500',
      bg: 'bg-primary-50',
      text: 'text-primary-700',
      label: 'Processando',
    },
    ignored: { dot: 'bg-slate-400', bg: 'bg-slate-50', text: 'text-slate-600', label: 'Ignorado' },
    pending: { dot: 'bg-amber-500', bg: 'bg-amber-50', text: 'text-amber-700', label: 'Pendente' },
    reprocessed: {
      dot: 'bg-violet-500',
      bg: 'bg-violet-50',
      text: 'text-violet-700',
      label: 'Reprocessado',
    },
  };

function formatDateTime(date: string): string {
  const d = new Date(date);
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function EmailIngestionPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [triggering, setTriggering] = useState(false);
  const [reprocessingId, setReprocessingId] = useState<number | null>(null);
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const limit = 20;

  const { data: status, isLoading: statusLoading } = useApiQuery<EmailStatus>(
    ['email-ingestion-status'],
    '/api/email-ingestion/status',
  );

  const logsParams = new URLSearchParams();
  logsParams.set('page', String(page));
  logsParams.set('limit', String(limit));
  if (startDate) logsParams.set('startDate', startDate);
  if (endDate) logsParams.set('endDate', endDate);

  const { data: logsResponse, isLoading: logsLoading } = useApiQuery<LogsResponse>(
    ['email-ingestion-logs', String(page), startDate, endDate],
    `/api/email-ingestion/logs?${logsParams.toString()}`,
  );

  const logs = logsResponse?.data;
  const pagination = logsResponse?.pagination;

  const totalPages = pagination?.pages ?? 1;

  const getStat = (key: string): number => {
    if (!status?.todayStats) return 0;
    const found = status.todayStats.find((s) => s.status === key);
    return found ? found.count : 0;
  };

  const totalToday = status?.todayStats?.reduce((sum, s) => sum + s.count, 0) ?? 0;

  const handleTrigger = async (includeRead = false) => {
    setTriggering(true);
    try {
      const qs = includeRead ? '?includeRead=true' : '';
      await api.post<TriggerResponse>(`/api/email-ingestion/trigger${qs}`);
      queryClient.invalidateQueries({ queryKey: ['email-ingestion-status'] });
      queryClient.invalidateQueries({ queryKey: ['email-ingestion-logs'] });
    } finally {
      setTriggering(false);
    }
  };

  const handleReprocess = async (logId: number) => {
    setReprocessingId(logId);
    try {
      await api.post<TriggerResponse>(`/api/email-ingestion/reprocess/${logId}`);
      queryClient.invalidateQueries({ queryKey: ['email-ingestion-logs'] });
    } finally {
      setReprocessingId(null);
    }
  };

  const statsCards = [
    { label: 'Total Hoje', value: totalToday, icon: Mail, gradient: 'from-slate-500 to-slate-600' },
    {
      label: 'Sucesso',
      value: getStat('completed'),
      icon: CheckCircle2,
      gradient: 'from-emerald-500 to-emerald-600',
    },
    {
      label: 'Falhas',
      value: getStat('failed'),
      icon: XCircle,
      gradient: 'from-danger-500 to-danger-600',
    },
    {
      label: 'Ignorados',
      value: getStat('ignored'),
      icon: Clock,
      gradient: 'from-amber-500 to-amber-600',
    },
  ];

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Ingestao de E-mail</h2>
        <p className="mt-1 text-sm text-slate-500">
          Monitore e gerencie a ingestao automatica de emails
        </p>
      </div>

      {/* Status Card */}
      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
        {/* Gradient top bar */}
        <div
          className={cn(
            'h-1',
            status?.enabled
              ? 'bg-gradient-to-r from-emerald-500 to-teal-500'
              : 'bg-gradient-to-r from-danger-400 to-danger-500',
          )}
        />

        {statusLoading ? (
          <LoadingSpinner className="py-8" />
        ) : (
          <div className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-6">
              <div className="flex flex-wrap items-center gap-6">
                {/* Live indicator */}
                <div
                  className={cn(
                    'flex items-center gap-2.5 rounded-xl px-4 py-2',
                    status?.enabled
                      ? 'bg-emerald-50 border border-emerald-200'
                      : 'bg-danger-50 border border-danger-200',
                  )}
                >
                  {status?.enabled ? (
                    <>
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                      </span>
                      <Wifi className="h-4 w-4 text-emerald-600" />
                      <span className="text-sm font-semibold text-emerald-700">Ativo</span>
                    </>
                  ) : (
                    <>
                      <span className="h-2.5 w-2.5 rounded-full bg-danger-500" />
                      <WifiOff className="h-4 w-4 text-danger-600" />
                      <span className="text-sm font-semibold text-danger-700">Inativo</span>
                    </>
                  )}
                </div>

                {/* Details */}
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <div className="flex items-center gap-1.5 text-slate-600">
                    <span className="font-medium text-slate-400">Metodo:</span>
                    {status?.method === 'gmail_api' ? (
                      <span className="font-medium text-emerald-600">
                        Gmail API{status.sharedMailbox ? ` (${status.sharedMailbox})` : ''}
                      </span>
                    ) : status?.method === 'imap' ? (
                      <span className="font-medium text-emerald-600">IMAP</span>
                    ) : (
                      <span className="font-medium text-danger-600">Nao configurado</span>
                    )}
                  </div>
                  <div className="hidden h-4 w-px bg-slate-200 sm:block" />
                  <div className="flex items-center gap-1.5 text-slate-600">
                    <span className="font-medium text-slate-400">Remetentes:</span>
                    <span>{status?.allowedSenders}</span>
                  </div>
                  <div className="hidden h-4 w-px bg-slate-200 sm:block" />
                  <div className="flex items-center gap-1.5 text-slate-600">
                    <span className="font-medium text-slate-400">Ultima verificacao:</span>
                    <span>{status?.lastRun ? formatDateTime(status.lastRun) : 'Nunca'}</span>
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleTrigger(false)}
                  disabled={triggering}
                  className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-primary-600 to-primary-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:from-primary-700 hover:to-primary-800 disabled:opacity-50 transition-all"
                >
                  <RefreshCw className={cn('h-4 w-4', triggering && 'animate-spin')} />
                  Verificar Novos
                </button>
                <button
                  onClick={() => handleTrigger(true)}
                  disabled={triggering}
                  className="inline-flex items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-4 py-2.5 text-sm font-semibold text-primary-700 hover:bg-primary-100 hover:border-primary-300 disabled:opacity-50 transition-all"
                >
                  <Inbox className={cn('h-4 w-4', triggering && 'animate-spin')} />
                  Buscar Todos
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {statsCards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold text-slate-900">{card.value}</p>
                  <p className="mt-0.5 text-sm text-slate-500">{card.label}</p>
                </div>
                <div
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br',
                    card.gradient,
                  )}
                >
                  <Icon className="h-5 w-5 text-white" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Date Filter */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
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
          {(startDate || endDate) && (
            <button
              onClick={() => {
                setStartDate('');
                setEndDate('');
                setPage(1);
              }}
              className="rounded-lg px-3 py-2 text-sm font-medium text-primary-600 hover:bg-primary-50 transition-colors"
            >
              Limpar datas
            </button>
          )}
        </div>
      </div>

      {/* Logs Table */}
      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-100 px-6 py-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2.5 text-base font-semibold text-slate-900">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100">
                <Inbox className="h-4 w-4 text-slate-600" />
              </div>
              Emails Processados
            </h3>
            {pagination && (
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                {pagination.total} registros
              </span>
            )}
          </div>
        </div>

        {logsLoading ? (
          <LoadingSpinner className="py-12" />
        ) : !logs?.length ? (
          <EmptyState
            icon={Inbox}
            title="Nenhum email processado"
            description="Nenhum email foi processado ainda."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-left">
                    <th className="px-3 py-2.5 sm:px-6 sm:py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Data/Hora
                    </th>
                    <th className="px-3 py-2.5 sm:px-6 sm:py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                      De
                    </th>
                    <th className="px-3 py-2.5 sm:px-6 sm:py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Assunto
                    </th>
                    <th className="px-3 py-2.5 sm:px-6 sm:py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Processo
                    </th>
                    <th className="px-3 py-2.5 sm:px-6 sm:py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Anexos
                    </th>
                    <th className="px-3 py-2.5 sm:px-6 sm:py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Status
                    </th>
                    <th className="px-3 py-2.5 sm:px-6 sm:py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Acoes
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {logs.map((log) => {
                    const badge = statusBadgeConfig[log.status] ?? statusBadgeConfig.pending;
                    const isExpanded = expandedLogId === log.id;
                    const hasDetails =
                      (log.status === 'failed' && log.errorMessage) ||
                      (log.status === 'completed' && log.processedAttachmentDetails?.length);
                    return (
                      <Fragment key={log.id}>
                        <tr className="hover:bg-slate-50 transition-colors">
                          <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5 text-slate-600">
                            {formatDateTime(log.receivedAt)}
                          </td>
                          <td
                            className="max-w-[180px] truncate px-3 py-2.5 sm:px-6 sm:py-3.5 text-slate-900 font-medium"
                            title={log.fromAddress}
                          >
                            {log.fromAddress}
                          </td>
                          <td className="max-w-[250px] px-3 py-2.5 sm:px-6 sm:py-3.5">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-slate-900" title={log.subject}>
                                {log.subject}
                              </span>
                              {hasDetails && (
                                <button
                                  onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                                  className="shrink-0 flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                                  aria-label={isExpanded ? 'Ocultar detalhes' : 'Ver detalhes'}
                                >
                                  <ChevronDown
                                    className={cn(
                                      'h-3.5 w-3.5 transition-transform',
                                      isExpanded && 'rotate-180',
                                    )}
                                  />
                                </button>
                              )}
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5">
                            {log.processId ? (
                              <Link
                                to={`/importacao/processos/${log.processId}`}
                                className="inline-flex items-center gap-1 text-primary-600 hover:text-primary-700 font-medium transition-colors"
                              >
                                {log.processCode ?? log.processId}
                                <ExternalLink className="h-3 w-3" />
                              </Link>
                            ) : (
                              <span className="text-slate-400">{log.processCode ?? '-'}</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5">
                            <div className="flex items-center gap-1.5 text-slate-600">
                              <Paperclip className="h-3.5 w-3.5 text-slate-400" />
                              {log.processedAttachments}/{log.attachmentsCount}
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5">
                            <span
                              className={cn(
                                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
                                badge.bg,
                                badge.text,
                              )}
                            >
                              <span className={cn('h-1.5 w-1.5 rounded-full', badge.dot)} />
                              {badge.label}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5">
                            {log.status === 'failed' && (
                              <button
                                onClick={() => handleReprocess(log.id)}
                                disabled={reprocessingId === log.id}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 hover:border-slate-300 disabled:opacity-50 transition-all"
                              >
                                <RotateCcw
                                  className={cn(
                                    'h-3 w-3',
                                    reprocessingId === log.id && 'animate-spin',
                                  )}
                                />
                                {reprocessingId === log.id ? 'Reprocessando...' : 'Reprocessar'}
                              </button>
                            )}
                          </td>
                        </tr>
                        {/* Expanded details row */}
                        {isExpanded && (
                          <tr key={`${log.id}-details`}>
                            <td colSpan={7} className="bg-slate-50/60 px-5 py-0">
                              <div className="py-3 pl-4 border-l-2 border-slate-200">
                                {log.status === 'failed' && log.errorMessage && (
                                  <div className="flex items-start gap-2 rounded-xl bg-danger-50 border border-danger-100 px-4 py-3 text-sm text-danger-700">
                                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger-500" />
                                    <span>{log.errorMessage}</span>
                                  </div>
                                )}
                                {log.status === 'completed' && log.processedAttachmentDetails && (
                                  <div className="space-y-1.5">
                                    <p className="text-xs font-medium uppercase tracking-wider text-slate-400 mb-2">
                                      Anexos processados
                                    </p>
                                    {log.processedAttachmentDetails.map((att, i) => (
                                      <div
                                        key={i}
                                        className="flex items-center gap-2.5 rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2 text-sm"
                                      >
                                        <Paperclip className="h-3.5 w-3.5 text-emerald-500" />
                                        <span className="font-medium text-emerald-800">
                                          {att.filename}
                                        </span>
                                        <span className="text-emerald-500">({att.type})</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {pagination && totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4">
                <p className="text-sm text-slate-500">
                  Pagina {pagination.page} de {totalPages} ({pagination.total} registros)
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50 transition-all"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Anterior
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50 transition-all"
                  >
                    Proximo
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
