import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Clock, AlertTriangle, CheckCircle, Calendar } from 'lucide-react';
import { useApiQuery } from '@/shared/hooks/useApi';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import { EmptyState } from '@/shared/components/EmptyState';
import { formatDate } from '@/shared/lib/utils';

interface FollowUpProcess {
  id: string;
  processCode: string;
  brand: string;
  currentStage: string;
  lastUpdateDate: string;
  daysSinceUpdate: number;
  status: 'on_track' | 'approaching' | 'overdue';
}

interface LiDeadline {
  id: string;
  processCode: string;
  brand: string;
  liDeadline: string;
  daysRemaining: number;
}

const STAGES = [
  { key: 'docs_received', label: 'Docs Recebidos' },
  { key: 'pre_inspection', label: 'Pre-Inspecao' },
  { key: 'ncm_verification', label: 'Verificacao NCM' },
  { key: 'espelho_generated', label: 'Espelho Gerado' },
  { key: 'sent_fenicia', label: 'Enviado Fenicia' },
  { key: 'li_submitted', label: 'LI Submetida' },
  { key: 'li_approved', label: 'LI Aprovada' },
] as const;

const statusColorMap = {
  on_track: 'border-l-green-500 bg-green-50/50',
  approaching: 'border-l-yellow-500 bg-yellow-50/50',
  overdue: 'border-l-red-500 bg-red-50/50',
};

const statusDotMap = {
  on_track: 'bg-green-500',
  approaching: 'bg-yellow-500',
  overdue: 'bg-red-500',
};

const brandColors: Record<string, string> = {
  puket: 'bg-pink-100 text-pink-700',
  imaginarium: 'bg-violet-100 text-violet-700',
};

export function FollowUpPage() {
  const navigate = useNavigate();
  const [showDeadlines, setShowDeadlines] = useState(true);

  const { data: followUpData, isLoading } = useApiQuery<FollowUpProcess[]>(
    ['follow-up'],
    '/api/follow-up',
  );

  const { data: liDeadlines, isLoading: loadingDeadlines } = useApiQuery<LiDeadline[]>(
    ['follow-up-deadlines'],
    '/api/follow-up/deadlines/li',
  );

  const getProcessesForStage = (stageKey: string) =>
    followUpData?.filter((p) => p.currentStage === stageKey) ?? [];

  if (isLoading) {
    return <LoadingSpinner className="py-24" size="lg" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Follow-Up</h2>
        <button
          onClick={() => setShowDeadlines(!showDeadlines)}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 lg:hidden"
        >
          <Calendar className="h-4 w-4" />
          Prazos LI
        </button>
      </div>

      <div className="flex items-center gap-6 text-sm text-gray-600">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full bg-green-500" />
          No prazo
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full bg-yellow-500" />
          Proximo ao prazo
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full bg-red-500" />
          Atrasado
        </div>
      </div>

      <div className="flex gap-6">
        <div className="flex-1 overflow-x-auto">
          <div className="flex gap-4" style={{ minWidth: `${STAGES.length * 220}px` }}>
            {STAGES.map((stage) => {
              const processes = getProcessesForStage(stage.key);
              return (
                <div key={stage.key} className="w-[220px] shrink-0">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-700">{stage.label}</h3>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                      {processes.length}
                    </span>
                  </div>
                  <div className="space-y-2 rounded-lg bg-gray-50 p-2 min-h-[200px]">
                    {processes.length === 0 ? (
                      <p className="py-8 text-center text-xs text-gray-400">Nenhum processo</p>
                    ) : (
                      processes.map((proc) => (
                        <button
                          key={proc.id}
                          onClick={() => navigate(`/processes/${proc.id}`)}
                          className={`w-full rounded-lg border-l-4 p-3 text-left shadow-sm transition-shadow hover:shadow-md ${statusColorMap[proc.status]}`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-gray-900">{proc.processCode}</span>
                            <span className={`inline-block h-2 w-2 rounded-full ${statusDotMap[proc.status]}`} />
                          </div>
                          <span
                            className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                              brandColors[proc.brand] || 'bg-gray-100 text-gray-700'
                            }`}
                          >
                            {proc.brand}
                          </span>
                          <div className="mt-2 flex items-center gap-1 text-xs text-gray-500">
                            <Clock className="h-3 w-3" />
                            {proc.daysSinceUpdate} dia{proc.daysSinceUpdate !== 1 ? 's' : ''} sem atualizacao
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div
          className={`w-80 shrink-0 ${showDeadlines ? 'block' : 'hidden'} lg:block`}
        >
          <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-4 py-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Prazos LI
              </h3>
            </div>
            <div className="max-h-[calc(100vh-300px)] overflow-y-auto">
              {loadingDeadlines ? (
                <LoadingSpinner className="py-8" size="sm" />
              ) : !liDeadlines?.length ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <CheckCircle className="h-8 w-8 text-gray-300" />
                  <p className="text-sm text-gray-400">Nenhum prazo de LI ativo</p>
                </div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {liDeadlines.map((item) => {
                    const isUrgent = item.daysRemaining <= 3;
                    const isWarning = item.daysRemaining <= 7 && item.daysRemaining > 3;
                    return (
                      <li key={item.id} className="px-4 py-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-gray-900">{item.processCode}</p>
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                                brandColors[item.brand] || 'bg-gray-100 text-gray-700'
                              }`}
                            >
                              {item.brand}
                            </span>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-gray-500">{formatDate(item.liDeadline)}</p>
                            <p
                              className={`text-sm font-semibold ${
                                isUrgent
                                  ? 'text-red-600'
                                  : isWarning
                                    ? 'text-yellow-600'
                                    : 'text-green-600'
                              }`}
                            >
                              {item.daysRemaining <= 0
                                ? 'Vencido'
                                : `${item.daysRemaining} dia${item.daysRemaining !== 1 ? 's' : ''}`}
                            </p>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>

      {!followUpData?.length && !isLoading && (
        <EmptyState
          icon={ClipboardList}
          title="Nenhum processo no follow-up"
          description="Os processos ativos aparecerao automaticamente no kanban."
        />
      )}
    </div>
  );
}

