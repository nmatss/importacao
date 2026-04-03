import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ClipboardList,
  Clock,
  AlertTriangle,
  CheckCircle,
  Calendar,
  ChevronDown,
  LayoutGrid,
} from 'lucide-react';
import { useApiQuery } from '@/shared/hooks/useApi';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { DateRangeFilter } from '@/shared/components/DateRangeFilter';
import { formatDate } from '@/shared/lib/utils';

interface RawFollowUpProcess {
  id: number;
  processId: number;
  processCode: string;
  brand: string;
  status: string;
  documentsReceivedAt: string | null;
  preInspectionAt: string | null;
  ncmVerifiedAt: string | null;
  espelhoGeneratedAt: string | null;
  sentToFeniciaAt: string | null;
  liSubmittedAt: string | null;
  liApprovedAt: string | null;
  overallProgress: number;
  updatedAt: string;
  createdAt: string;
}

interface FollowUpProcess extends RawFollowUpProcess {
  currentStage: string;
  daysSinceUpdate: number;
  followUpStatus: 'on_track' | 'approaching' | 'overdue';
}

interface LiDeadline {
  processId: number;
  processCode: string;
  brand: string;
  liDeadline: string;
  daysRemaining: number;
}

// Compute currentStage from the latest completed tracking date
const STAGE_DATE_FIELDS: { key: string; field: keyof RawFollowUpProcess }[] = [
  { key: 'li_approved', field: 'liApprovedAt' },
  { key: 'li_submitted', field: 'liSubmittedAt' },
  { key: 'sent_fenicia', field: 'sentToFeniciaAt' },
  { key: 'espelho_generated', field: 'espelhoGeneratedAt' },
  { key: 'ncm_verification', field: 'ncmVerifiedAt' },
  { key: 'pre_inspection', field: 'preInspectionAt' },
  { key: 'docs_received', field: 'documentsReceivedAt' },
];

function enrichFollowUpData(raw: RawFollowUpProcess[]): FollowUpProcess[] {
  return raw.map((proc) => {
    // Find the most advanced completed stage
    let currentStage = 'docs_received';
    for (const stage of STAGE_DATE_FIELDS) {
      if (proc[stage.field]) {
        currentStage = stage.key;
        break;
      }
    }

    // Compute days since last update
    const lastUpdate = proc.updatedAt || proc.createdAt;
    const daysSinceUpdate = Math.max(
      0,
      Math.floor((Date.now() - new Date(lastUpdate).getTime()) / 86400000),
    );

    // Determine follow-up status
    let followUpStatus: 'on_track' | 'approaching' | 'overdue' = 'on_track';
    if (daysSinceUpdate > 7) followUpStatus = 'overdue';
    else if (daysSinceUpdate > 3) followUpStatus = 'approaching';

    return { ...proc, currentStage, daysSinceUpdate, followUpStatus };
  });
}

const STAGES = [
  { key: 'docs_received', label: 'Docs Recebidos', color: 'bg-sky-500' },
  { key: 'pre_inspection', label: 'Pre-Inspecao', color: 'bg-primary-500' },
  { key: 'ncm_verification', label: 'Verificacao NCM', color: 'bg-violet-500' },
  { key: 'espelho_generated', label: 'Espelho Gerado', color: 'bg-fuchsia-500' },
  { key: 'sent_fenicia', label: 'Enviado Fenicia', color: 'bg-amber-500' },
  { key: 'li_submitted', label: 'LI Submetida', color: 'bg-orange-500' },
  { key: 'li_approved', label: 'LI Aprovada', color: 'bg-emerald-500' },
] as const;

const statusConfig = {
  on_track: {
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    accent: 'bg-emerald-500',
    text: 'text-emerald-700',
    label: 'No prazo',
  },
  approaching: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    accent: 'bg-amber-500',
    text: 'text-amber-700',
    label: 'Proximo ao prazo',
  },
  overdue: {
    bg: 'bg-danger-50',
    border: 'border-danger-200',
    accent: 'bg-danger-500',
    text: 'text-danger-700',
    label: 'Atrasado',
  },
};

const brandColors: Record<string, { bg: string; text: string; dot: string }> = {
  puket: { bg: 'bg-pink-50', text: 'text-pink-700', dot: 'bg-pink-400' },
  imaginarium: { bg: 'bg-violet-50', text: 'text-violet-700', dot: 'bg-violet-400' },
};

const defaultBrandColor = { bg: 'bg-slate-100', text: 'text-slate-700', dot: 'bg-slate-400' };

function formatStageDate(date: string | null): string {
  if (!date) return '-';
  const d = new Date(date);
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const STAGE_DATE_LABELS: { key: keyof FollowUpProcess; label: string }[] = [
  { key: 'documentsReceivedAt', label: 'Docs Recebidos' },
  { key: 'preInspectionAt', label: 'Pre-Inspecao' },
  { key: 'ncmVerifiedAt', label: 'NCM Verificado' },
  { key: 'espelhoGeneratedAt', label: 'Espelho Gerado' },
  { key: 'sentToFeniciaAt', label: 'Enviado Fenicia' },
  { key: 'liSubmittedAt', label: 'LI Submetida' },
  { key: 'liApprovedAt', label: 'LI Aprovada' },
];

export function FollowUpPage() {
  const navigate = useNavigate();
  const [showDeadlines, setShowDeadlines] = useState(true);
  const [expandedProcessId, setExpandedProcessId] = useState<number | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const followUpParams = new URLSearchParams();
  followUpParams.set('limit', '200');
  if (startDate) followUpParams.set('startDate', startDate);
  if (endDate) followUpParams.set('endDate', endDate);
  const followUpQs = followUpParams.toString();

  const {
    data: followUpResponse,
    isLoading,
    error,
    refetch,
  } = useApiQuery<{ data: RawFollowUpProcess[]; pagination: unknown }>(
    ['follow-up', startDate, endDate],
    `/api/follow-up${followUpQs ? `?${followUpQs}` : ''}`,
  );
  const followUpData = followUpResponse?.data
    ? enrichFollowUpData(followUpResponse.data)
    : undefined;

  const { data: liDeadlines, isLoading: loadingDeadlines } = useApiQuery<LiDeadline[]>(
    ['follow-up-deadlines'],
    '/api/follow-up/deadlines/li',
  );

  const getProcessesForStage = (stageKey: string) =>
    followUpData?.filter((p) => p.currentStage === stageKey) ?? [];

  if (error) {
    return <ErrorState message="Erro ao carregar follow-up." onRetry={() => refetch()} />;
  }

  if (isLoading) {
    return <LoadingSpinner className="py-24" size="lg" />;
  }

  const totalProcesses = followUpData?.length ?? 0;
  const overdueCount = followUpData?.filter((p) => p.followUpStatus === 'overdue').length ?? 0;
  const approachingCount =
    followUpData?.filter((p) => p.followUpStatus === 'approaching').length ?? 0;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-600 shadow-sm">
            <LayoutGrid className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Follow-Up</h2>
            <p className="text-sm text-slate-500">
              {totalProcesses} processo{totalProcesses !== 1 ? 's' : ''} em andamento
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowDeadlines(!showDeadlines)}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-all hover:bg-slate-50 hover:shadow lg:hidden"
        >
          <Calendar className="h-4 w-4 text-slate-400" />
          Prazos LI
        </button>
      </div>

      {/* Status Legend & Date Filter */}
      <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200/80 bg-white px-5 py-3.5 shadow-sm flex-wrap">
        <DateRangeFilter
          startDate={startDate}
          endDate={endDate}
          onStartDateChange={setStartDate}
          onEndDateChange={setEndDate}
        />
        <div className="hidden h-8 w-px bg-slate-200 sm:block" />
        {Object.entries(statusConfig).map(([key, config]) => {
          const count =
            key === 'overdue'
              ? overdueCount
              : key === 'approaching'
                ? approachingCount
                : totalProcesses - overdueCount - approachingCount;
          return (
            <div key={key} className="flex items-center gap-2 text-sm">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${config.accent}`} />
              <span className="text-slate-600">{config.label}</span>
              <span
                className={`ml-0.5 rounded-full px-1.5 py-0.5 text-xs font-semibold ${config.bg} ${config.text}`}
              >
                {count}
              </span>
            </div>
          );
        })}
      </div>

      {/* Main Content */}
      <div className="flex gap-6">
        {/* Kanban Board */}
        <div className="flex-1 overflow-x-auto">
          <div className="flex gap-4" style={{ minWidth: `${STAGES.length * 240}px` }}>
            {STAGES.map((stage) => {
              const processes = getProcessesForStage(stage.key);
              return (
                <div key={stage.key} className="w-[240px] shrink-0">
                  {/* Column Header */}
                  <div className="mb-3 flex items-center gap-2.5">
                    <div className={`h-2 w-2 rounded-full ${stage.color}`} />
                    <h3 className="text-sm font-semibold text-slate-700">{stage.label}</h3>
                    <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">
                      {processes.length}
                    </span>
                  </div>

                  {/* Column Body */}
                  <div className="space-y-2.5 rounded-2xl border border-slate-200/60 bg-slate-50/50 p-2.5 min-h-[220px]">
                    {processes.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-center">
                        <div className="mb-2 h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center">
                          <ClipboardList className="h-4 w-4 text-slate-300" />
                        </div>
                        <p className="text-xs text-slate-400">Nenhum processo</p>
                      </div>
                    ) : (
                      processes.map((proc) => {
                        const status = statusConfig[proc.followUpStatus];
                        const brand = brandColors[proc.brand] ?? defaultBrandColor;
                        const isExpanded = expandedProcessId === proc.id;

                        return (
                          <div
                            key={proc.id}
                            className={`rounded-xl border bg-white shadow-sm transition-all hover:shadow-md ${status.border}`}
                          >
                            {/* Status accent bar */}
                            <div className={`h-1 rounded-t-xl ${status.accent}`} />

                            <button
                              onClick={() => navigate(`/importacao/processos/${proc.id}`)}
                              className="w-full px-3.5 pt-2.5 pb-2 text-left"
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-semibold text-slate-900">
                                  {proc.processCode}
                                </span>
                                <span
                                  className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${status.bg} ${status.text}`}
                                >
                                  {proc.followUpStatus === 'overdue'
                                    ? 'Atrasado'
                                    : proc.followUpStatus === 'approaching'
                                      ? 'Atencao'
                                      : 'OK'}
                                </span>
                              </div>
                              <div className="mt-1.5 flex items-center gap-1.5">
                                <span
                                  className={`inline-block h-1.5 w-1.5 rounded-full ${brand.dot}`}
                                />
                                <span className={`text-xs font-medium ${brand.text}`}>
                                  {proc.brand}
                                </span>
                              </div>
                              <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
                                <Clock className="h-3 w-3" />
                                <span>
                                  {proc.daysSinceUpdate} dia{proc.daysSinceUpdate !== 1 ? 's' : ''}{' '}
                                  sem atualizacao
                                </span>
                              </div>
                            </button>

                            {/* Expand toggle */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedProcessId(isExpanded ? null : proc.id);
                              }}
                              className="flex w-full items-center justify-center border-t border-slate-100 py-1.5 text-xs text-slate-300 hover:text-slate-500 transition-colors"
                            >
                              <ChevronDown
                                className={`h-3.5 w-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                              />
                            </button>

                            {/* Expanded timeline */}
                            {isExpanded && (
                              <div className="border-t border-slate-100 px-3.5 pb-3 pt-2 space-y-1">
                                {STAGE_DATE_LABELS.map((s) => {
                                  const val = proc[s.key] as string | null;
                                  return (
                                    <div
                                      key={s.key}
                                      className="flex items-center justify-between text-[11px]"
                                    >
                                      <span className="text-slate-400">{s.label}</span>
                                      <span
                                        className={
                                          val ? 'font-medium text-slate-700' : 'text-slate-300'
                                        }
                                      >
                                        {formatStageDate(val)}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* LI Deadlines Sidebar */}
        <div className={`w-80 shrink-0 ${showDeadlines ? 'block' : 'hidden'} lg:block`}>
          <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 shadow-sm">
                  <AlertTriangle className="h-4 w-4 text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Prazos LI</h3>
                  <p className="text-xs text-slate-400">
                    {liDeadlines?.length ?? 0} prazo{(liDeadlines?.length ?? 0) !== 1 ? 's' : ''}{' '}
                    ativo{(liDeadlines?.length ?? 0) !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>
            </div>
            <div className="max-h-[calc(100vh-300px)] overflow-y-auto">
              {loadingDeadlines ? (
                <LoadingSpinner className="py-8" size="sm" />
              ) : !liDeadlines?.length ? (
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-50">
                    <CheckCircle className="h-6 w-6 text-slate-300" />
                  </div>
                  <p className="text-sm text-slate-400">Nenhum prazo de LI ativo</p>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {liDeadlines.map((item) => {
                    const isUrgent = item.daysRemaining <= 3;
                    const isWarning = item.daysRemaining <= 7 && item.daysRemaining > 3;
                    const brand = brandColors[item.brand] ?? defaultBrandColor;

                    let urgencyBg = 'bg-emerald-50';
                    let urgencyText = 'text-emerald-700';
                    if (isUrgent) {
                      urgencyBg = 'bg-danger-50';
                      urgencyText = 'text-danger-700';
                    } else if (isWarning) {
                      urgencyBg = 'bg-amber-50';
                      urgencyText = 'text-amber-700';
                    }

                    return (
                      <li
                        key={item.processId}
                        className="px-5 py-3.5 transition-colors hover:bg-slate-50/50"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">
                              {item.processCode}
                            </p>
                            <div className="mt-1 flex items-center gap-1.5">
                              <span
                                className={`inline-block h-1.5 w-1.5 rounded-full ${brand.dot}`}
                              />
                              <span className={`text-xs font-medium ${brand.text}`}>
                                {item.brand}
                              </span>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-slate-400">{formatDate(item.liDeadline)}</p>
                            <span
                              className={`mt-1 inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold ${urgencyBg} ${urgencyText}`}
                            >
                              {item.daysRemaining <= 0 ? 'Vencido' : `${item.daysRemaining}d`}
                            </span>
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
    </div>
  );
}
