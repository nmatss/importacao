import { useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Bell, AlertTriangle, Info, CheckCircle2, Shield, Clock, ExternalLink } from 'lucide-react';
import { useApiQuery, useApiMutation } from '@/shared/hooks/useApi';
import { api } from '@/shared/lib/api-client';
import { formatDate, cn } from '@/shared/lib/utils';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import { EmptyState } from '@/shared/components/EmptyState';

interface Alert {
  id: string;
  processId: string | null;
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

const severityConfig = {
  info: {
    icon: Info,
    dot: 'bg-blue-500',
    bar: 'bg-blue-500',
    badgeBg: 'bg-blue-50',
    badgeText: 'text-blue-700',
    iconColor: 'text-blue-600',
    iconBg: 'bg-blue-50',
    label: 'Info',
  },
  warning: {
    icon: AlertTriangle,
    dot: 'bg-amber-500',
    bar: 'bg-amber-500',
    badgeBg: 'bg-amber-50',
    badgeText: 'text-amber-700',
    iconColor: 'text-amber-600',
    iconBg: 'bg-amber-50',
    label: 'Aviso',
  },
  critical: {
    icon: AlertTriangle,
    dot: 'bg-red-500',
    bar: 'bg-red-500',
    badgeBg: 'bg-red-50',
    badgeText: 'text-red-700',
    iconColor: 'text-red-600',
    iconBg: 'bg-red-50',
    label: 'Critico',
  },
} as const;

type SeverityFilter = 'all' | 'info' | 'warning' | 'critical';
type AckFilter = 'all' | 'true' | 'false';

const severityOptions: { value: SeverityFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'critical', label: 'Critico' },
  { value: 'warning', label: 'Aviso' },
  { value: 'info', label: 'Info' },
];

const ackOptions: { value: AckFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'false', label: 'Pendentes' },
  { value: 'true', label: 'Reconhecidos' },
];

export function AlertsPage() {
  const queryClient = useQueryClient();
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [ackFilter, setAckFilter] = useState<AckFilter>('all');

  const queryParams = new URLSearchParams();
  if (severityFilter !== 'all') queryParams.set('severity', severityFilter);
  if (ackFilter !== 'all') queryParams.set('acknowledged', ackFilter);
  const qs = queryParams.toString();

  const { data: alertsResponse, isLoading } = useApiQuery<{ data: Alert[]; pagination: unknown }>(
    ['alerts', severityFilter, ackFilter],
    `/api/alerts${qs ? `?${qs}` : ''}`,
  );
  const alerts = alertsResponse?.data;

  const acknowledgeMutation = useApiMutation<AckResponse, void>(
    '',
    'patch',
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['alerts'] });
      },
    },
  );

  const handleAcknowledge = async (alertId: string) => {
    try {
      await api.patch<AckResponse>(`/api/alerts/${alertId}/acknowledge`);
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
    } catch (err: any) {
      toast.error(err.message || 'Erro ao reconhecer alerta');
    }
  };

  const pendingCount = alerts?.filter((a) => !a.acknowledged).length ?? 0;

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Alertas</h2>
          <p className="mt-1 text-sm text-slate-500">Monitore e gerencie alertas do sistema</p>
        </div>
        {pendingCount > 0 && (
          <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-4 py-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
            </span>
            <span className="text-sm font-semibold text-amber-700">{pendingCount} pendente{pendingCount !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>

      {/* Filter Pills */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-6">
          {/* Severity Filter */}
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">Severidade</p>
            <div className="flex items-center gap-1.5">
              {severityOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setSeverityFilter(opt.value)}
                  className={cn(
                    'rounded-lg px-3.5 py-1.5 text-sm font-medium transition-all',
                    severityFilter === opt.value
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Divider */}
          <div className="hidden h-8 w-px bg-slate-200 sm:block" />

          {/* Ack Filter */}
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">Status</p>
            <div className="flex items-center gap-1.5">
              {ackOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setAckFilter(opt.value)}
                  className={cn(
                    'rounded-lg px-3.5 py-1.5 text-sm font-medium transition-all',
                    ackFilter === opt.value
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
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
      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-100 px-6 py-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2.5 text-base font-semibold text-slate-900">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100">
                <Shield className="h-4 w-4 text-slate-600" />
              </div>
              Alertas do Sistema
            </h3>
            {alerts?.length ? (
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                {alerts.length} alerta{alerts.length !== 1 ? 's' : ''}
              </span>
            ) : null}
          </div>
        </div>

        {isLoading ? (
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
                    'relative border-b border-slate-100 last:border-b-0 transition-colors',
                    alert.acknowledged ? 'bg-slate-50/50' : 'bg-white',
                  )}
                >
                  {/* Severity bar on left */}
                  <div className={cn('absolute left-0 top-0 bottom-0 w-1', config.bar)} />

                  <div className="flex items-start gap-4 px-6 py-5 pl-7">
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
                        <span className="text-sm font-semibold text-slate-900">
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
                            Reconhecido
                          </span>
                        )}
                      </div>

                      <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{alert.message}</p>

                      {alert.processId && (
                        <Link
                          to={`/importacao/processos/${alert.processId}`}
                          className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors"
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
                            Reconhecido em {formatDate(alert.acknowledgedAt)}
                            {alert.acknowledgedBy && ` por ${alert.acknowledgedBy}`}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Action */}
                    {!alert.acknowledged && (
                      <button
                        onClick={() => handleAcknowledge(alert.id)}
                        className="shrink-0 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 hover:border-slate-300 transition-all"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Reconhecer
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
