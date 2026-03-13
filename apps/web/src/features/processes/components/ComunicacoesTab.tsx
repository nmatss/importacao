import { useState } from 'react';
import { toast } from 'sonner';
import {
  Send,
  MessageSquare,
  User,
  Paperclip,
  AlertTriangle,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '@/shared/hooks/useApi';
import { cn, formatDateTime } from '@/shared/lib/utils';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import type { Communication } from '@/shared/types';

export interface ComunicacoesTabProps {
  processId: string;
}

export function ComunicacoesTab({ processId }: ComunicacoesTabProps) {
  const queryClient = useQueryClient();

  const { data: response, isLoading } = useApiQuery<{ data: Communication[]; pagination: unknown }>(
    ['communications', processId],
    `/api/communications/process/${processId}`,
  );

  const [sending, setSending] = useState<number | null>(null);

  const sendEmail = async (id: number) => {
    setSending(id);
    try {
      const token = localStorage.getItem('importacao_token');
      const baseUrl = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${baseUrl}/api/communications/${id}/send`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Falha ao enviar');
      queryClient.invalidateQueries({ queryKey: ['communications', processId] });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro ao enviar comunicacao';
      toast.error(message);
    } finally {
      setSending(null);
    }
  };

  if (isLoading) return <LoadingSpinner className="py-8" />;

  const comms = response?.data ?? [];

  const statusColor = (s: string) => {
    switch (s) {
      case 'sent': return 'bg-emerald-100 text-emerald-700';
      case 'draft': return 'bg-slate-100 text-slate-600';
      case 'failed': return 'bg-red-100 text-red-700';
      default: return 'bg-slate-100 text-slate-600';
    }
  };

  const statusLabel = (s: string) => {
    switch (s) {
      case 'sent': return 'Enviado';
      case 'draft': return 'Rascunho';
      case 'failed': return 'Falhou';
      default: return s;
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-slate-800">Comunicacoes</h3>
      {comms.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
            <MessageSquare className="h-6 w-6 text-slate-300" />
          </div>
          <p className="text-sm text-slate-400 font-medium">
            Nenhuma comunicacao registrada.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {comms.map((comm) => (
            <div
              key={comm.id}
              className="rounded-xl border border-slate-200/80 bg-white p-5 hover:bg-slate-50/30 transition-colors"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className={cn('shrink-0 inline-flex rounded-lg px-2.5 py-1 text-xs font-bold uppercase tracking-wide', statusColor(comm.status))}>
                    {statusLabel(comm.status)}
                  </span>
                  <span className="text-sm font-semibold text-slate-800 truncate">
                    {comm.subject}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {comm.status === 'draft' && (
                    <button
                      onClick={() => sendEmail(comm.id)}
                      disabled={sending === comm.id}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      {sending === comm.id ? <LoadingSpinner size="sm" /> : <Send className="h-3.5 w-3.5" />}
                      Enviar
                    </button>
                  )}
                  <span className="text-xs text-slate-400 font-medium">
                    {formatDateTime(comm.sentAt || comm.createdAt)}
                  </span>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                <User className="h-3.5 w-3.5" />
                <span className="font-medium">{comm.recipient}</span>
                <span className="text-slate-300">|</span>
                <span>{comm.recipientEmail}</span>
              </div>
              {comm.attachments && comm.attachments.length > 0 && (
                <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                  <Paperclip className="h-3.5 w-3.5" />
                  <span>{comm.attachments.length} anexo{comm.attachments.length !== 1 ? 's' : ''}</span>
                </div>
              )}
              {comm.errorMessage && (
                <div className="mt-2 flex items-center gap-2 text-xs text-red-500">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span>{comm.errorMessage}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
