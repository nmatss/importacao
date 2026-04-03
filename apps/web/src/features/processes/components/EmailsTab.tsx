import { FileText, Paperclip, AlertTriangle, Inbox, User } from 'lucide-react';
import { useApiQuery } from '@/shared/hooks/useApi';
import { cn, formatDateTime } from '@/shared/lib/utils';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import type { EmailLog } from '@/shared/types';

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `${diffMin} min atras`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h atras`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return '1 dia atras';
  return `${diffDays} dias atras`;
}

function extractSenderName(fromAddress: string): string {
  // Try to extract "Name <email>" pattern
  const match = fromAddress.match(/^(.+?)\s*<.+>$/);
  if (match) return match[1].trim().replace(/^["']|["']$/g, '');
  // If it's just an email, return the part before @
  const atIdx = fromAddress.indexOf('@');
  if (atIdx > 0) return fromAddress.substring(0, atIdx);
  return fromAddress;
}

export interface EmailsTabProps {
  processId: string;
  processCode: string;
}

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  completed: { color: 'bg-emerald-100 text-emerald-700', label: 'Concluido' },
  processing: { color: 'bg-primary-100 text-primary-700', label: 'Processando' },
  pending: { color: 'bg-slate-100 text-slate-600', label: 'Pendente' },
  failed: { color: 'bg-danger-100 text-danger-700', label: 'Falhou' },
  ignored: { color: 'bg-slate-100 text-slate-400', label: 'Ignorado' },
};

export function EmailsTab({ processId, processCode }: EmailsTabProps) {
  const { data: response, isLoading } = useApiQuery<{ data: EmailLog[]; pagination: unknown }>(
    ['email-logs', processId],
    `/api/email-ingestion/logs?limit=50`,
  );

  if (isLoading) return <LoadingSpinner className="py-8" />;

  // Filter logs related to this process
  const allLogs = response?.data ?? [];
  const logs = allLogs.filter(
    (l) => l.processCode === processCode || String(l.processCode) === processCode,
  );

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-slate-800">Emails Recebidos</h3>
      <p className="text-sm text-slate-500">
        Emails processados automaticamente que foram vinculados a este processo.
      </p>
      {logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-50 border border-slate-100">
            <Inbox className="h-8 w-8 text-slate-300" />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-slate-500">
              Nenhum email vinculado a este processo
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Emails recebidos com referencia ao processo aparecerao aqui automaticamente.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {logs.map((log) => {
            const cfg = STATUS_CONFIG[log.status] ?? STATUS_CONFIG.pending;
            return (
              <div
                key={log.id}
                className="rounded-xl border border-slate-200/60 bg-white p-4 hover:bg-slate-50/30 transition-colors"
              >
                {/* Header: status + date */}
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={cn(
                      'shrink-0 inline-flex rounded-lg px-2 py-0.5 text-xs font-semibold',
                      cfg.color,
                    )}
                  >
                    {cfg.label}
                  </span>
                  <div className="flex items-center gap-2 shrink-0 text-xs text-slate-400">
                    <span className="font-medium" title={formatDateTime(log.receivedAt)}>
                      {relativeTime(log.receivedAt)}
                    </span>
                    <span className="text-slate-300">|</span>
                    <span>{formatDateTime(log.receivedAt)}</span>
                  </div>
                </div>

                {/* Subject */}
                <p className="mt-2 text-sm font-semibold text-slate-800 line-clamp-2">
                  {log.subject}
                </p>

                {/* Subject preview (first 100 chars) */}
                {log.subject && log.subject.length > 60 && (
                  <p className="mt-0.5 text-xs text-slate-400 truncate">
                    {log.subject.slice(0, 100)}
                  </p>
                )}

                {/* Sender */}
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <div className="flex items-center gap-1.5 text-slate-600">
                    <User className="h-3 w-3 text-slate-400" />
                    <span className="font-medium">{extractSenderName(log.fromAddress)}</span>
                  </div>
                  <span className="text-slate-300">&lt;{log.fromAddress}&gt;</span>
                </div>

                {/* Attachments with filenames */}
                {log.attachmentsCount > 0 && (
                  <div className="mt-2 flex items-start gap-2">
                    <Paperclip className="h-3 w-3 text-slate-400 mt-0.5 shrink-0" />
                    <div className="flex flex-wrap gap-1.5">
                      {log.processedAttachments && log.processedAttachments.length > 0 ? (
                        log.processedAttachments.map((att, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600 border border-slate-200/50"
                          >
                            <FileText className="h-3 w-3" />
                            {att.filename}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-slate-400">
                          {log.attachmentsCount} anexo{log.attachmentsCount !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {log.errorMessage && (
                  <div className="mt-2 text-xs text-danger-500 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    {log.errorMessage}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
