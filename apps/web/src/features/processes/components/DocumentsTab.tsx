import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import {
  RefreshCw,
  CheckCircle,
  Clock,
  ChevronDown,
  Upload,
  Inbox,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '@/shared/hooks/useApi';
import { useAuth } from '@/shared/hooks/useAuth';
import { DocumentUpload } from '@/features/documents/DocumentUpload';
import { DocumentList } from '@/features/documents/DocumentList';
import { cn } from '@/shared/lib/utils';

export interface DocumentsTabProps {
  processId: string;
}

interface EmailStatus {
  enabled: boolean;
  method: string;
  lastRun?: string;
  gmailConfigured?: boolean;
}

export function DocumentsTab({ processId }: DocumentsTabProps) {
  const queryClient = useQueryClient();
  const { getToken } = useAuth();
  const [syncing, setSyncing] = useState(false);
  const [showManualUpload, setShowManualUpload] = useState(true);
  const [countdown, setCountdown] = useState(300);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const resetCountdown = useCallback(() => {
    setCountdown(300);
  }, []);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          queryClient.invalidateQueries({ queryKey: ['documents', processId] });
          return 300;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [queryClient, processId]);

  const { data: emailStatus } = useApiQuery<EmailStatus>(
    ['email-status'],
    '/api/email-ingestion/status',
    { staleTime: 30000 },
  );

  const triggerEmailSync = async () => {
    setSyncing(true);
    try {
      const token = getToken();
      const baseUrl = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${baseUrl}/api/email-ingestion/trigger?includeRead=true`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Falha ao buscar emails');
      toast.success('Emails verificados — documentos atualizados');
      // Refresh document list + reset countdown
      queryClient.invalidateQueries({ queryKey: ['documents', processId] });
      resetCountdown();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao sincronizar emails';
      toast.error(msg);
    } finally {
      setSyncing(false);
    }
  };

  const lastCheckTime = emailStatus?.lastRun
    ? new Date(emailStatus.lastRun).toLocaleString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
      })
    : null;

  return (
    <div className="space-y-4">
      {/* Email sync header — primary action */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary-100 dark:border-primary-800 bg-gradient-to-r from-primary-50 to-primary-50 dark:from-primary-950/30 dark:to-primary-950/30 px-3 py-3 sm:px-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-100 dark:bg-primary-900/50">
          <Inbox className="h-5 w-5 text-primary-600" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Documentos chegam automaticamente via email
          </p>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            {emailStatus?.enabled ? (
              <>
                <span className="inline-flex items-center gap-1 text-emerald-600">
                  <CheckCircle className="h-3 w-3" />
                  {emailStatus.method === 'gmail_api'
                    ? 'Gmail API'
                    : emailStatus.method === 'imap'
                      ? 'IMAP'
                      : 'Email'}{' '}
                  ativo
                </span>
                {lastCheckTime && (
                  <>
                    <span className="text-slate-300 dark:text-slate-600">|</span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Ultima busca: {lastCheckTime}
                    </span>
                  </>
                )}
              </>
            ) : (
              <span className="inline-flex items-center gap-1 text-amber-600">
                <AlertCircle className="h-3 w-3" />
                Email nao configurado — use upload manual
              </span>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={triggerEmailSync}
          disabled={syncing}
          className={cn(
            'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all',
            syncing
              ? 'bg-primary-100 text-primary-400 cursor-wait'
              : 'bg-primary-600 text-white hover:bg-primary-700 shadow-sm',
          )}
        >
          {syncing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {syncing ? 'Buscando...' : 'Buscar Emails Agora'}
        </button>
        <span className="text-xs text-slate-400 font-mono tabular-nums">
          Proxima busca em {Math.floor(countdown / 60)}m {String(countdown % 60).padStart(2, '0')}s
        </span>
      </div>

      {/* Document list — main content */}
      <DocumentList processId={processId} />

      {/* Manual upload — collapsible, open by default */}
      <div className="border-t border-slate-100 dark:border-slate-700 pt-3">
        <button
          type="button"
          onClick={() => setShowManualUpload(!showManualUpload)}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-900 hover:text-slate-800 dark:text-slate-100"
        >
          <Upload className="h-4 w-4" />
          <span>Enviar Documento</span>
          <ChevronDown
            className={cn(
              'ml-auto h-3.5 w-3.5 transition-transform',
              showManualUpload && 'rotate-180',
            )}
          />
        </button>

        {showManualUpload && (
          <div className="mt-2">
            <DocumentUpload processId={processId} />
          </div>
        )}
      </div>
    </div>
  );
}
