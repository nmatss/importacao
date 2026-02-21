import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Bell, AlertTriangle, Info, CheckCircle2 } from 'lucide-react';
import { useApiQuery, useApiMutation } from '@/shared/hooks/useApi';
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

interface ApiResponse {
  success: boolean;
  data: Alert[];
}

interface AckResponse {
  success: boolean;
  data: Alert;
}

const severityConfig = {
  info: {
    icon: Info,
    badge: 'bg-blue-100 text-blue-700',
    border: 'border-blue-200',
    label: 'Info',
  },
  warning: {
    icon: AlertTriangle,
    badge: 'bg-amber-100 text-amber-700',
    border: 'border-amber-200',
    label: 'Aviso',
  },
  critical: {
    icon: AlertTriangle,
    badge: 'bg-red-100 text-red-700',
    border: 'border-red-200',
    label: 'Critico',
  },
} as const;

type SeverityFilter = 'all' | 'info' | 'warning' | 'critical';
type AckFilter = 'all' | 'true' | 'false';

export function AlertsPage() {
  const queryClient = useQueryClient();
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [ackFilter, setAckFilter] = useState<AckFilter>('all');

  const queryParams = new URLSearchParams();
  if (severityFilter !== 'all') queryParams.set('severity', severityFilter);
  if (ackFilter !== 'all') queryParams.set('acknowledged', ackFilter);
  const qs = queryParams.toString();

  const { data: response, isLoading } = useApiQuery<ApiResponse>(
    ['alerts', severityFilter, ackFilter],
    `/api/alerts${qs ? `?${qs}` : ''}`,
  );

  const alerts = response?.data;

  const acknowledgeMutation = useApiMutation<AckResponse, void>(
    '',
    'patch',
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['alerts'] });
      },
    },
  );

  const handleAcknowledge = (alertId: string) => {
    // useApiMutation doesn't support dynamic URLs, so use api client directly
    import('@/shared/lib/api-client').then(({ api }) => {
      api.patch<AckResponse>(`/api/alerts/${alertId}/acknowledge`).then(() => {
        queryClient.invalidateQueries({ queryKey: ['alerts'] });
      });
    });
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Alertas</h2>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Severidade</label>
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value as SeverityFilter)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            <option value="all">Todas</option>
            <option value="info">Info</option>
            <option value="warning">Aviso</option>
            <option value="critical">Critico</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
          <select
            value={ackFilter}
            onChange={(e) => setAckFilter(e.target.value as AckFilter)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            <option value="all">Todos</option>
            <option value="false">Pendentes</option>
            <option value="true">Reconhecidos</option>
          </select>
        </div>
      </div>

      {/* Alerts list */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-5 py-4">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
            <Bell className="h-5 w-5 text-gray-500" />
            Alertas do Sistema
          </h3>
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
          <ul className="divide-y divide-gray-100">
            {alerts.map((alert) => {
              const config = severityConfig[alert.severity];
              const SeverityIcon = config.icon;

              return (
                <li
                  key={alert.id}
                  className={cn(
                    'px-5 py-4',
                    alert.acknowledged ? 'bg-gray-50' : 'bg-white',
                  )}
                >
                  <div className="flex items-start gap-4">
                    <div
                      className={cn(
                        'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                        alert.severity === 'info' && 'bg-blue-100',
                        alert.severity === 'warning' && 'bg-amber-100',
                        alert.severity === 'critical' && 'bg-red-100',
                      )}
                    >
                      <SeverityIcon
                        className={cn(
                          'h-4 w-4',
                          alert.severity === 'info' && 'text-blue-600',
                          alert.severity === 'warning' && 'text-amber-600',
                          alert.severity === 'critical' && 'text-red-600',
                        )}
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">
                          {alert.title}
                        </span>
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                            config.badge,
                          )}
                        >
                          {config.label}
                        </span>
                        {alert.acknowledged && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                            <CheckCircle2 className="h-3 w-3" />
                            Reconhecido
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-gray-600">{alert.message}</p>
                      {alert.processId && (
                        <p className="mt-1 text-xs">
                          <Link
                            to={`/processos/${alert.processId}`}
                            className="text-blue-600 hover:text-blue-700 hover:underline font-medium"
                          >
                            {alert.processCode || alert.processId}
                          </Link>
                        </p>
                      )}
                      <div className="mt-2 flex items-center gap-3 text-xs text-gray-400">
                        <span>{formatDate(alert.createdAt)}</span>
                        {alert.acknowledgedAt && (
                          <span>
                            Reconhecido em {formatDate(alert.acknowledgedAt)}
                            {alert.acknowledgedBy && ` por ${alert.acknowledgedBy}`}
                          </span>
                        )}
                      </div>
                    </div>

                    {!alert.acknowledged && (
                      <button
                        onClick={() => handleAcknowledge(alert.id)}
                        className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Reconhecer
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
