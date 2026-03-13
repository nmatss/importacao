import {
  FileText,
  Mail,
  Paperclip,
  AlertTriangle,
} from 'lucide-react';
import { useApiQuery } from '@/shared/hooks/useApi';
import { cn, formatDateTime } from '@/shared/lib/utils';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import type { EmailLog } from '@/shared/types';

export interface EmailsTabProps {
  processId: string;
  processCode: string;
}

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  completed: { color: 'bg-emerald-100 text-emerald-700', label: 'Concluido' },
  processing: { color: 'bg-blue-100 text-blue-700', label: 'Processando' },
  pending: { color: 'bg-slate-100 text-slate-600', label: 'Pendente' },
  failed: { color: 'bg-red-100 text-red-700', label: 'Falhou' },
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
  const logs = allLogs.filter(l => l.processCode === processCode || String(l.processCode) === processCode);

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-slate-800">Emails Recebidos</h3>
      <p className="text-sm text-slate-500">
        Emails processados automaticamente que foram vinculados a este processo.
      </p>
      {logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
            <Mail className="h-6 w-6 text-slate-300" />
          </div>
          <p className="text-sm text-slate-400 font-medium">
            Nenhum email vinculado a este processo.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {logs.map((log) => {
            const cfg = STATUS_CONFIG[log.status] ?? STATUS_CONFIG.pending;
            return (
              <div
                key={log.id}
                className="rounded-xl border border-slate-200/80 bg-white p-4 hover:bg-slate-50/30 transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={cn('shrink-0 inline-flex rounded-lg px-2 py-0.5 text-xs font-semibold', cfg.color)}>
                      {cfg.label}
                    </span>
                    <span className="text-sm font-semibold text-slate-800 truncate">{log.subject}</span>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400 font-medium">
                    {formatDateTime(log.receivedAt)}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-3 text-xs text-slate-400">
                  <span className="font-medium">{log.fromAddress}</span>
                  {log.attachmentsCount > 0 && (
                    <>
                      <span className="h-1 w-1 rounded-full bg-slate-300" />
                      <span className="flex items-center gap-1">
                        <Paperclip className="h-3 w-3" />
                        {log.attachmentsCount} anexo{log.attachmentsCount !== 1 ? 's' : ''}
                      </span>
                    </>
                  )}
                </div>
                {log.processedAttachments && log.processedAttachments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {log.processedAttachments.map((att, i) => (
                      <span key={i} className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                        <FileText className="h-3 w-3" />
                        {att.filename}
                      </span>
                    ))}
                  </div>
                )}
                {log.errorMessage && (
                  <div className="mt-2 text-xs text-red-500 flex items-center gap-1">
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
