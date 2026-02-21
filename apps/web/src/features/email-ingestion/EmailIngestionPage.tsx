import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Inbox, RefreshCw, ChevronLeft, ChevronRight, ChevronDown, AlertCircle } from 'lucide-react';
import { useApiQuery } from '@/shared/hooks/useApi';
import { cn } from '@/shared/lib/utils';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import { EmptyState } from '@/shared/components/EmptyState';
import { api } from '@/shared/lib/api-client';

interface AttachmentDetail {
  filename: string;
  type: string;
  documentId: string | null;
}

interface EmailLog {
  id: string;
  messageId: string;
  fromAddress: string;
  subject: string;
  receivedAt: string;
  processId: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'ignored';
  attachmentsCount: number;
  processedAttachments: number;
  processedAttachmentDetails?: AttachmentDetail[];
  errorMessage: string | null;
  processCode: string | null;
  createdAt: string;
}

interface StatusResponse {
  success: boolean;
  data: {
    enabled: boolean;
    method: 'gmail_api' | 'imap' | 'none';
    gmailConfigured: boolean;
    imapConfigured: boolean;
    sharedMailbox: string | null;
    allowedSenders: string;
    lastRun: string | null;
    todayStats: { status: string; count: number }[];
  };
}

interface LogsResponse {
  success: boolean;
  data: EmailLog[];
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
}

interface TriggerResponse {
  success: boolean;
  data: { message: string };
}

const statusBadgeConfig: Record<string, { classes: string; label: string }> = {
  completed: { classes: 'bg-green-100 text-green-700', label: 'Concluido' },
  failed: { classes: 'bg-red-100 text-red-700', label: 'Falha' },
  processing: { classes: 'bg-blue-100 text-blue-700', label: 'Processando' },
  ignored: { classes: 'bg-gray-100 text-gray-700', label: 'Ignorado' },
  pending: { classes: 'bg-yellow-100 text-yellow-700', label: 'Pendente' },
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
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const limit = 20;

  const { data: statusResponse, isLoading: statusLoading } = useApiQuery<StatusResponse>(
    ['email-ingestion-status'],
    '/api/email-ingestion/status',
  );

  const { data: logsResponse, isLoading: logsLoading } = useApiQuery<LogsResponse>(
    ['email-ingestion-logs', String(page)],
    `/api/email-ingestion/logs?page=${page}&limit=${limit}`,
  );

  const status = statusResponse?.data;
  const logs = logsResponse?.data;
  const pagination = logsResponse?.pagination;

  const totalPages = pagination ? Math.ceil(pagination.total / pagination.limit) : 1;

  const getStat = (key: string): number => {
    if (!status?.todayStats) return 0;
    const found = status.todayStats.find((s) => s.status === key);
    return found ? found.count : 0;
  };

  const totalToday = status?.todayStats?.reduce((sum, s) => sum + s.count, 0) ?? 0;

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      await api.post<TriggerResponse>('/api/email-ingestion/trigger');
      queryClient.invalidateQueries({ queryKey: ['email-ingestion-status'] });
      queryClient.invalidateQueries({ queryKey: ['email-ingestion-logs'] });
    } finally {
      setTriggering(false);
    }
  };

  const handleReprocess = async (logId: string) => {
    setReprocessingId(logId);
    try {
      await api.post<TriggerResponse>(`/api/email-ingestion/reprocess/${logId}`);
      queryClient.invalidateQueries({ queryKey: ['email-ingestion-logs'] });
    } finally {
      setReprocessingId(null);
    }
  };

  const statsCards = [
    { label: 'Total Hoje', value: totalToday, color: 'text-gray-900', bg: 'bg-gray-50' },
    { label: 'Sucesso', value: getStat('completed'), color: 'text-green-700', bg: 'bg-green-50' },
    { label: 'Falhas', value: getStat('failed'), color: 'text-red-700', bg: 'bg-red-50' },
    { label: 'Ignorados', value: getStat('ignored'), color: 'text-yellow-700', bg: 'bg-yellow-50' },
  ];

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Ingestao de E-mail</h2>

      {/* Status Card */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        {statusLoading ? (
          <LoadingSpinner className="py-4" />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'h-3 w-3 rounded-full',
                    status?.enabled ? 'bg-green-500' : 'bg-red-500',
                  )}
                />
                <span className="text-sm font-medium text-gray-700">
                  {status?.enabled ? 'Ativo' : 'Inativo'}
                </span>
              </div>
              <div className="text-sm text-gray-500">
                <span className="font-medium">Metodo:</span>{' '}
                {status?.method === 'gmail_api' ? (
                  <span className="text-green-600">Gmail API{status.sharedMailbox ? ` (${status.sharedMailbox})` : ''}</span>
                ) : status?.method === 'imap' ? (
                  <span className="text-green-600">IMAP</span>
                ) : (
                  <span className="text-red-600">Nao configurado</span>
                )}
              </div>
              <div className="text-sm text-gray-500">
                <span className="font-medium">Remetentes:</span>{' '}
                {status?.allowedSenders}
              </div>
              <div className="text-sm text-gray-500">
                <span className="font-medium">Ultima verificacao:</span>{' '}
                {status?.lastRun ? formatDateTime(status.lastRun) : 'Nunca'}
              </div>
            </div>
            <button
              onClick={handleTrigger}
              disabled={triggering}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={cn('h-4 w-4', triggering && 'animate-spin')} />
              Verificar Agora
            </button>
          </div>
        )}
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {statsCards.map((card) => (
          <div
            key={card.label}
            className={cn('rounded-lg border border-gray-200 p-4 shadow-sm', card.bg)}
          >
            <p className={cn('text-2xl font-bold', card.color)}>{card.value}</p>
            <p className="text-sm text-gray-500">{card.label}</p>
          </div>
        ))}
      </div>

      {/* Logs Table */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-5 py-4">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
            <Inbox className="h-5 w-5 text-gray-500" />
            Emails Processados
          </h3>
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
                  <tr className="border-b border-gray-200 bg-gray-50 text-left">
                    <th className="px-4 py-3 font-medium text-gray-700">Data/Hora</th>
                    <th className="px-4 py-3 font-medium text-gray-700">De</th>
                    <th className="px-4 py-3 font-medium text-gray-700">Assunto</th>
                    <th className="px-4 py-3 font-medium text-gray-700">Processo</th>
                    <th className="px-4 py-3 font-medium text-gray-700">Anexos</th>
                    <th className="px-4 py-3 font-medium text-gray-700">Status</th>
                    <th className="px-4 py-3 font-medium text-gray-700">Acoes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {logs.map((log) => {
                    const badge = statusBadgeConfig[log.status] ?? statusBadgeConfig.pending;
                    const isExpanded = expandedLogId === log.id;
                    const hasDetails = log.status === 'failed' && log.errorMessage
                      || log.status === 'completed' && log.processedAttachmentDetails?.length;
                    return (
                      <tr key={log.id} className="hover:bg-gray-50 group">
                        <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                          {formatDateTime(log.receivedAt)}
                        </td>
                        <td className="max-w-[180px] truncate px-4 py-3 text-gray-900" title={log.fromAddress}>
                          {log.fromAddress}
                        </td>
                        <td className="max-w-[220px] truncate px-4 py-3 text-gray-900" title={log.subject}>
                          <div className="flex items-center gap-1">
                            {log.subject}
                            {hasDetails && (
                              <button
                                onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                                className="ml-1 text-gray-400 hover:text-gray-600"
                              >
                                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', isExpanded && 'rotate-180')} />
                              </button>
                            )}
                          </div>
                          {/* Error message for failed (Gap 8) */}
                          {isExpanded && log.status === 'failed' && log.errorMessage && (
                            <div className="mt-2 flex items-start gap-1.5 rounded bg-red-50 px-2 py-1.5 text-xs text-red-700">
                              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                              {log.errorMessage}
                            </div>
                          )}
                          {/* Attachment details for completed (Gap 8) */}
                          {isExpanded && log.status === 'completed' && log.processedAttachmentDetails && (
                            <div className="mt-2 space-y-1 text-xs">
                              {log.processedAttachmentDetails.map((att, i) => (
                                <div key={i} className="flex items-center gap-2 rounded bg-green-50 px-2 py-1 text-green-700">
                                  <span className="font-medium">{att.filename}</span>
                                  <span className="text-green-500">({att.type})</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {log.processId ? (
                            <Link
                              to={`/processos/${log.processId}`}
                              className="text-blue-600 hover:text-blue-800 hover:underline"
                            >
                              {log.processCode ?? log.processId}
                            </Link>
                          ) : (
                            <span className="text-gray-400">{log.processCode ?? '-'}</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                          {log.processedAttachments}/{log.attachmentsCount}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span
                            className={cn(
                              'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                              badge.classes,
                            )}
                          >
                            {badge.label}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {log.status === 'failed' && (
                            <button
                              onClick={() => handleReprocess(log.id)}
                              disabled={reprocessingId === log.id}
                              className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                            >
                              {reprocessingId === log.id ? 'Reprocessando...' : 'Reprocessar'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {pagination && totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3">
                <p className="text-sm text-gray-500">
                  Pagina {pagination.page} de {totalPages} ({pagination.total} registros)
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Anterior
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
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
