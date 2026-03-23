import { useState } from 'react';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Circle,
  Clock,
  FileCheck,
  FolderOpen,
  Search,
  Ship,
  FileSpreadsheet,
  Send,
  PenTool,
  Mail,
  ClipboardList,
  FileText,
  ShieldCheck,
  Stamp,
} from 'lucide-react';
import { useApiQuery } from '@/shared/hooks/useApi';
import { cn } from '@/shared/lib/utils';
import { CHECKLIST_STEPS } from '@/shared/lib/constants';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';

interface FollowUpData {
  id: number;
  processId: number;
  overallProgress: number;
  [key: string]: unknown;
}

interface DocumentChecklistTabProps {
  processId: string;
}

const STEP_ICONS: Record<string, React.ElementType> = {
  documentsReceivedAt: FileCheck,
  preInspectionAt: Search,
  savedToFolderAt: FolderOpen,
  ncmVerifiedAt: ClipboardList,
  ncmBlCheckedAt: Ship,
  freightBlCheckedAt: Ship,
  espelhoBuiltAt: FileSpreadsheet,
  invoiceSentFeniciaAt: Send,
  espelhoGeneratedAt: FileSpreadsheet,
  signaturesCollectedAt: PenTool,
  signedDocsSentAt: Mail,
  sentToFeniciaAt: FileText,
  diDraftAt: Stamp,
  liSubmittedAt: ShieldCheck,
  liApprovedAt: ShieldCheck,
};

function formatTimestamp(val: unknown): string | null {
  if (!val) return null;
  const d = new Date(val as string);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function DocumentChecklistTab({ processId }: DocumentChecklistTabProps) {
  const [toggling, setToggling] = useState<string | null>(null);

  const {
    data: followUp,
    isLoading,
    refetch,
  } = useApiQuery<FollowUpData>(['follow-up', processId], `/api/follow-up/${processId}`);

  const toggleStep = async (stepKey: string) => {
    setToggling(stepKey);
    try {
      const token = localStorage.getItem('importacao_token');
      const baseUrl = import.meta.env.VITE_API_URL || '';
      const isCompleted = followUp && followUp[stepKey];

      const res = await fetch(`${baseUrl}/api/follow-up/${processId}/step`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          step: stepKey,
          completedAt: isCompleted ? null : new Date().toISOString(),
        }),
      });

      if (!res.ok) throw new Error('Falha ao atualizar passo');
      await refetch();

      const stepLabel = CHECKLIST_STEPS.find((s) => s.key === stepKey)?.label ?? stepKey;
      if (isCompleted) {
        toast.info(`${stepLabel} desmarcado`);
      } else {
        toast.success(`${stepLabel} concluido`);
      }
    } catch (err: any) {
      toast.error(err.message || 'Erro ao atualizar checklist');
    } finally {
      setToggling(null);
    }
  };

  if (isLoading) {
    return <LoadingSpinner className="py-8" />;
  }

  const completedCount = CHECKLIST_STEPS.filter((s) => followUp && followUp[s.key]).length;
  const totalSteps = CHECKLIST_STEPS.length;
  const progressPct = Math.round((completedCount / totalSteps) * 100);

  return (
    <div className="space-y-4">
      {/* Progress header */}
      <div className="flex items-center gap-4 rounded-lg bg-slate-50 px-4 py-3">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium text-slate-700">Conferencia Documental</span>
            <span className="text-xs font-semibold text-slate-500">
              {completedCount}/{totalSteps} passos ({progressPct}%)
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                progressPct === 100
                  ? 'bg-green-500'
                  : progressPct > 50
                    ? 'bg-blue-500'
                    : 'bg-amber-500',
              )}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Checklist */}
      <div className="space-y-1">
        {CHECKLIST_STEPS.map((step, index) => {
          const isCompleted = !!(followUp && followUp[step.key]);
          const isToggling = toggling === step.key;
          const Icon = STEP_ICONS[step.key] || Circle;
          const timestamp = formatTimestamp(followUp?.[step.key]);

          return (
            <button
              key={step.key}
              type="button"
              onClick={() => toggleStep(step.key)}
              disabled={isToggling}
              className={cn(
                'group flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-all',
                isCompleted
                  ? 'border-green-200 bg-green-50/50 hover:bg-green-50'
                  : 'border-slate-150 bg-white hover:bg-slate-50 hover:border-slate-200',
                isToggling && 'opacity-60',
              )}
            >
              {/* Step number */}
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                  isCompleted ? 'bg-green-500 text-white' : 'bg-slate-200 text-slate-500',
                )}
              >
                {isCompleted ? <CheckCircle2 className="h-3.5 w-3.5" /> : String(index + 1)}
              </span>

              {/* Icon */}
              <Icon
                className={cn(
                  'h-4 w-4 shrink-0',
                  isCompleted ? 'text-green-500' : 'text-slate-400',
                )}
              />

              {/* Content */}
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'text-sm font-medium',
                    isCompleted ? 'text-green-700' : 'text-slate-700',
                  )}
                >
                  {step.label}
                </p>
                <p className="text-xs text-slate-400 truncate">{step.description}</p>
              </div>

              {/* Timestamp or status */}
              <div className="shrink-0 text-right">
                {isToggling ? (
                  <LoadingSpinner size="sm" />
                ) : isCompleted && timestamp ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-green-600">
                    <Clock className="h-3 w-3" />
                    {timestamp}
                  </span>
                ) : (
                  <span className="text-[11px] text-slate-300 group-hover:text-slate-400">
                    Clique para concluir
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
