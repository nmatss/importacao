import { useEffect, useState, useRef } from 'react';
import { cn, certStatusColor } from '@/shared/lib/utils';
import { streamCertValidation } from '@/shared/lib/cert-api-client';
import type { CertValidationEvent } from '@/shared/lib/cert-api-client';
import { CheckCircle2, Loader2, AlertCircle } from 'lucide-react';

type ProgressEvent = CertValidationEvent;

export function CertValidationProgress({
  runId,
  onComplete,
}: {
  runId: string | null;
  onComplete?: (summary: any) => void;
}) {
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [status, setStatus] = useState<'running' | 'complete' | 'error'>('running');
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!runId) return;

    setEvents([]);
    setProgress({ current: 0, total: 0 });
    setStatus('running');

    const es = streamCertValidation(runId, (data: ProgressEvent) => {
      if (data.type === 'progress') {
        setProgress({ current: data.current || 0, total: data.total || 0 });
        setEvents((prev) => [...prev, data]);
      } else if (data.type === 'complete') {
        setStatus('complete');
        onComplete?.(data.summary);
      } else if (data.type === 'error') {
        setStatus('error');
      }
    });

    return () => es.close();
  }, [runId]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [events]);

  if (!runId) return null;

  const pct = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;

  const STATUS_LABELS: Record<string, string> = {
    OK: 'Conforme',
    INCONSISTENT: 'Inconsistente',
    URL_NOT_FOUND: 'Não Encontrado',
    API_ERROR: 'Erro de API',
    NO_EXPECTED: 'Sem Certificação',
  };

  const statusIcon = {
    running: <Loader2 className="w-[18px] h-[18px] text-emerald-600 animate-spin" />,
    complete: <CheckCircle2 className="w-[18px] h-[18px] text-emerald-600" />,
    error: <AlertCircle className="w-[18px] h-[18px] text-danger-600" />,
  };

  const statusLabel = {
    running: `Validando... ${progress.current}/${progress.total}`,
    complete: 'Validação completa!',
    error: 'Erro na validação',
  };

  const progressBarColor = {
    running: 'bg-gradient-to-r from-emerald-500 to-emerald-600',
    complete: 'bg-gradient-to-r from-emerald-500 to-emerald-600',
    error: 'bg-gradient-to-r from-danger-500 to-danger-600',
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 dark:border-slate-600/80 shadow-sm overflow-hidden">
      <div className="p-5 border-b border-slate-100 dark:border-slate-700">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            {statusIcon[status]}
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              {statusLabel[status]}
            </span>
          </div>
          <span
            className={cn(
              'text-xs font-bold px-2.5 py-1 rounded-lg',
              status === 'complete'
                ? 'bg-emerald-50 text-emerald-700'
                : status === 'error'
                  ? 'bg-danger-50 text-danger-700'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400',
            )}
          >
            {pct.toFixed(0)}%
          </span>
        </div>
        <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-2.5 overflow-hidden">
          <div
            className={cn(
              'h-2.5 rounded-full transition-all duration-500 ease-out',
              progressBarColor[status],
              status === 'running' &&
                'relative after:absolute after:inset-0 after:bg-gradient-to-r after:from-transparent after:via-white/20 after:to-transparent after:animate-pulse',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div ref={logRef} className="max-h-64 overflow-auto font-mono text-xs">
        {events.map((e, i) => {
          const statusDotColor = (() => {
            switch (e.product?.status) {
              case 'OK':
                return 'bg-emerald-500';
              case 'INCONSISTENT':
                return 'bg-amber-500';
              default:
                return 'bg-slate-400';
            }
          })();

          return (
            <div
              key={i}
              className={cn(
                'flex items-center gap-3 px-5 py-2',
                i % 2 === 0 ? 'bg-white dark:bg-slate-800' : 'bg-slate-50/60',
              )}
            >
              <span className="text-slate-400 w-8 text-right tabular-nums font-medium">
                {e.current}
              </span>
              <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', statusDotColor)} />
              <span
                className={cn(
                  'px-2 py-0.5 rounded-md text-[10px] font-semibold min-w-[80px] text-center',
                  certStatusColor(e.product?.status || ''),
                )}
              >
                {STATUS_LABELS[e.product?.status || ''] || e.product?.status}
              </span>
              <span className="text-slate-700 dark:text-slate-300 font-medium shrink-0">
                {e.product?.sku}
              </span>
              <span className="text-slate-400 truncate">{e.product?.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
