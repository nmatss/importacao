import { useState } from 'react';
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Minus,
  Play,
  Brain,
  Wrench,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '@/shared/hooks/useApi';
import { cn } from '@/shared/lib/utils';
import { VALIDATION_CHECK_NAMES } from '@/shared/lib/constants';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';

interface ValidationCheck {
  id: string;
  checkName: string;
  status: 'pass' | 'fail' | 'warning' | 'skipped';
  expectedValue?: string;
  actualValue?: string;
  message?: string;
}

interface Anomaly {
  field: string;
  description: string;
  severity: 'high' | 'medium' | 'low';
  confidence: number;
}

interface ValidationChecklistProps {
  processId: string;
}

const checkLabel = (name: string) =>
  VALIDATION_CHECK_NAMES.find((c) => c.value === name)?.description ?? name;

const statusConfig = {
  pass: {
    icon: CheckCircle,
    border: 'border-green-200',
    bg: 'bg-green-50',
    iconColor: 'text-green-500',
  },
  fail: {
    icon: XCircle,
    border: 'border-red-200',
    bg: 'bg-red-50',
    iconColor: 'text-red-500',
  },
  warning: {
    icon: AlertTriangle,
    border: 'border-amber-200',
    bg: 'bg-amber-50',
    iconColor: 'text-amber-500',
  },
  skipped: {
    icon: Minus,
    border: 'border-gray-200',
    bg: 'bg-gray-50',
    iconColor: 'text-gray-400',
  },
};

export function ValidationChecklist({ processId }: ValidationChecklistProps) {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);
  const [detectingAnomalies, setDetectingAnomalies] = useState(false);
  const [anomalies, setAnomalies] = useState<Anomaly[] | null>(null);

  const { data: checks, isLoading } = useApiQuery<ValidationCheck[]>(
    ['validation', processId],
    `/api/validation/${processId}`,
  );

  const runValidation = async () => {
    setRunning(true);
    try {
      const token = localStorage.getItem('importacao_token');
      const baseUrl = import.meta.env.VITE_API_URL || '/api';
      await fetch(`${baseUrl}/api/validation/${processId}/run`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      queryClient.invalidateQueries({ queryKey: ['validation', processId] });
    } finally {
      setRunning(false);
    }
  };

  const detectAnomalies = async () => {
    setDetectingAnomalies(true);
    try {
      const token = localStorage.getItem('importacao_token');
      const baseUrl = import.meta.env.VITE_API_URL || '/api';
      const res = await fetch(`${baseUrl}/api/validation/${processId}/anomalies`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      setAnomalies(data.anomalies ?? data);
    } finally {
      setDetectingAnomalies(false);
    }
  };

  const resolveManually = async (checkId: string) => {
    const token = localStorage.getItem('importacao_token');
    const baseUrl = import.meta.env.VITE_API_URL || '/api';
    await fetch(`${baseUrl}/api/validation/${processId}/checks/${checkId}/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ resolution: 'manual' }),
    });
    queryClient.invalidateQueries({ queryKey: ['validation', processId] });
  };

  if (isLoading) {
    return <LoadingSpinner className="py-8" />;
  }

  return (
    <div className="space-y-4">
      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={runValidation}
          disabled={running}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {running ? (
            <LoadingSpinner size="sm" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          Executar Validação
        </button>
        <button
          onClick={detectAnomalies}
          disabled={detectingAnomalies}
          className="inline-flex items-center gap-2 rounded-lg border border-purple-300 bg-purple-50 px-4 py-2 text-sm font-medium text-purple-700 hover:bg-purple-100 disabled:opacity-50 transition-colors"
        >
          {detectingAnomalies ? (
            <LoadingSpinner size="sm" />
          ) : (
            <Brain className="h-4 w-4" />
          )}
          Detectar Anomalias (IA)
        </button>
      </div>

      {/* Checks grid */}
      {checks && checks.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {checks.map((check) => {
            const config = statusConfig[check.status];
            const Icon = config.icon;

            return (
              <div
                key={check.id}
                className={cn(
                  'rounded-lg border p-4 transition-colors',
                  config.border,
                  config.bg,
                )}
              >
                <div className="flex items-start gap-3">
                  <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', config.iconColor)} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900">
                      {checkLabel(check.checkName)}
                    </p>
                    {check.message && (
                      <p className="mt-0.5 text-xs text-gray-600">{check.message}</p>
                    )}
                    {check.status === 'fail' &&
                      (check.expectedValue || check.actualValue) && (
                        <div className="mt-2 space-y-1 text-xs">
                          {check.expectedValue && (
                            <p>
                              <span className="text-gray-500">Esperado: </span>
                              <span className="font-medium text-gray-800">
                                {check.expectedValue}
                              </span>
                            </p>
                          )}
                          {check.actualValue && (
                            <p>
                              <span className="text-gray-500">Encontrado: </span>
                              <span className="font-medium text-red-700">
                                {check.actualValue}
                              </span>
                            </p>
                          )}
                        </div>
                      )}
                    {check.status === 'fail' && (
                      <button
                        onClick={() => resolveManually(check.id)}
                        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
                      >
                        <Wrench className="h-3 w-3" />
                        Resolver Manualmente
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="py-6 text-center text-sm text-gray-500">
          Nenhuma validação executada ainda. Clique em "Executar Validação" para iniciar.
        </p>
      )}

      {/* Anomalies */}
      {anomalies && anomalies.length > 0 && (
        <div className="rounded-lg border border-purple-200 bg-purple-50 p-4">
          <h4 className="mb-3 text-sm font-semibold text-purple-900">
            Anomalias Detectadas pela IA
          </h4>
          <div className="space-y-2">
            {anomalies.map((anomaly, i) => (
              <div
                key={i}
                className="flex items-start gap-3 rounded-lg bg-white p-3 border border-purple-100"
              >
                <AlertTriangle
                  className={cn(
                    'mt-0.5 h-4 w-4 shrink-0',
                    anomaly.severity === 'high'
                      ? 'text-red-500'
                      : anomaly.severity === 'medium'
                        ? 'text-amber-500'
                        : 'text-blue-500',
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900">{anomaly.field}</p>
                  <p className="text-xs text-gray-600">{anomaly.description}</p>
                </div>
                <span className="text-xs text-gray-400">
                  {(anomaly.confidence * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {anomalies && anomalies.length === 0 && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-center">
          <CheckCircle className="mx-auto h-6 w-6 text-green-500" />
          <p className="mt-1 text-sm text-green-700">
            Nenhuma anomalia detectada pela IA.
          </p>
        </div>
      )}
    </div>
  );
}
