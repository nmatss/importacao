import {
  FileText,
  ClipboardCheck,
  FileEdit,
  ShieldCheck,
  Sparkles,
  Send,
  Clock,
  Flag,
  CheckCircle,
  XCircle,
  BarChart3,
} from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import type { FollowUpTracking } from '@/shared/types';

export interface ProcessTimelineProps {
  currentStatus: string;
  followUp: FollowUpTracking | null;
}

const STEPS = [
  { key: 'draft', label: 'Rascunho', icon: FileEdit },
  { key: 'documents_received', label: 'Docs Recebidos', icon: FileText },
  { key: 'validating', label: 'Validando', icon: ClipboardCheck },
  { key: 'validated', label: 'Validado', icon: ShieldCheck },
  { key: 'espelho_generated', label: 'Espelho', icon: Sparkles },
  { key: 'sent_to_fenicia', label: 'Fenicia', icon: Send },
  { key: 'li_pending', label: 'LI Pendente', icon: Clock },
  { key: 'completed', label: 'Concluido', icon: Flag },
] as const;

function Stepper({ currentStatus }: { currentStatus: string }) {
  const isCancelled = currentStatus === 'cancelled';
  const currentIndex = STEPS.findIndex((s) => s.key === currentStatus);

  return (
    <div className="overflow-x-auto">
      {isCancelled && (
        <div className="mb-4 flex items-center gap-2.5 rounded-xl bg-red-50 border border-red-200/60 px-4 py-3 text-sm font-semibold text-red-700">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-100">
            <XCircle className="h-4 w-4 text-red-600" />
          </div>
          Processo Cancelado
        </div>
      )}
      <div className="flex min-w-[700px] items-center px-2 py-1">
        {STEPS.map((step, i) => {
          const isCompleted = !isCancelled && i < currentIndex;
          const isCurrent = !isCancelled && i === currentIndex;
          const StepIcon = step.icon;

          return (
            <div key={step.key} className="flex flex-1 items-center">
              <div className="flex flex-col items-center gap-2">
                <div
                  className={cn(
                    'relative flex h-10 w-10 items-center justify-center rounded-xl text-sm font-semibold transition-all duration-300',
                    isCancelled
                      ? 'bg-slate-100 text-slate-400'
                      : isCompleted
                        ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-md shadow-emerald-200'
                        : isCurrent
                          ? 'bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-lg shadow-blue-200 ring-4 ring-blue-100'
                          : 'bg-slate-100 text-slate-400',
                  )}
                >
                  {isCompleted ? (
                    <CheckCircle className="h-5 w-5" />
                  ) : (
                    <StepIcon className="h-4.5 w-4.5" />
                  )}
                </div>
                <span
                  className={cn(
                    'text-[11px] text-center leading-tight max-w-[80px] font-medium transition-colors',
                    isCancelled
                      ? 'text-slate-400'
                      : isCompleted
                        ? 'text-emerald-700'
                        : isCurrent
                          ? 'font-bold text-blue-700'
                          : 'text-slate-400',
                  )}
                >
                  {step.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className="relative mx-2 flex-1 h-1 rounded-full overflow-hidden bg-slate-100">
                  <div
                    className={cn(
                      'absolute inset-y-0 left-0 rounded-full transition-all duration-500',
                      !isCancelled && i < currentIndex
                        ? 'w-full bg-gradient-to-r from-emerald-400 to-emerald-500'
                        : !isCancelled && i === currentIndex
                          ? 'w-1/2 bg-gradient-to-r from-blue-400 to-blue-300'
                          : 'w-0',
                    )}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FollowUpProgress({ followUp }: { followUp: FollowUpTracking }) {
  return (
    <div className="mt-4 flex items-center gap-3">
      <BarChart3 className="h-4 w-4 text-slate-400" />
      <div className="flex-1">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-slate-500">Progresso Geral</span>
          <span className="text-xs font-bold text-slate-700">{followUp.overallProgress}%</span>
        </div>
        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-500"
            style={{ width: `${followUp.overallProgress}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export function ProcessTimeline({ currentStatus, followUp }: ProcessTimelineProps) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
      <Stepper currentStatus={currentStatus} />
      {followUp && <FollowUpProgress followUp={followUp} />}
    </div>
  );
}
