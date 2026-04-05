import { useState } from 'react';
import {
  FileText,
  ClipboardCheck,
  FileEdit,
  FileSpreadsheet,
  ShieldCheck,
  Send,
  CheckCircle,
  CalendarDays,
  StickyNote,
  Timer,
} from 'lucide-react';
import { useApiQuery } from '@/shared/hooks/useApi';
import { cn, formatDate, formatDateTime } from '@/shared/lib/utils';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import { TableSkeleton } from '@/shared/components/Skeleton';
import type { FollowUpTracking } from '@/shared/types';

export interface FollowUpTabProps {
  processId: string;
}

const FOLLOW_UP_STEPS = [
  { key: 'documentsReceivedAt', label: 'Documentos Recebidos', icon: FileText },
  { key: 'preInspectionAt', label: 'Pre-Inspecao', icon: ClipboardCheck },
  { key: 'ncmVerifiedAt', label: 'NCM Verificado', icon: ShieldCheck },
  { key: 'espelhoGeneratedAt', label: 'Espelho Gerado', icon: FileSpreadsheet },
  { key: 'sentToFeniciaAt', label: 'Enviado a Fenicia', icon: Send },
  { key: 'liSubmittedAt', label: 'LI Submetida', icon: FileEdit },
  { key: 'liApprovedAt', label: 'LI Aprovada', icon: CheckCircle },
] as const;

export function FollowUpTab({ processId }: FollowUpTabProps) {
  const { data: tracking, isLoading } = useApiQuery<FollowUpTracking>(
    ['followup', processId],
    `/api/follow-up/${processId}`,
  );

  if (isLoading) return <TableSkeleton />;

  if (!tracking) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
          <CalendarDays className="h-6 w-6 text-slate-300" />
        </div>
        <p className="text-sm text-slate-400 font-medium">
          Nenhum acompanhamento encontrado para este processo.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-slate-800">Acompanhamento (Follow-Up)</h3>
        <span className="text-sm font-semibold text-slate-500">
          Progresso: <span className="text-primary-700">{tracking.overallProgress}%</span>
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary-500 to-emerald-500 transition-all duration-500"
          style={{ width: `${tracking.overallProgress}%` }}
        />
      </div>

      {/* Steps timeline */}
      <div className="space-y-3">
        {FOLLOW_UP_STEPS.map(({ key, label, icon: StepIcon }) => {
          const dateValue = tracking[key as keyof FollowUpTracking] as string | null;
          const isCompleted = !!dateValue;

          return (
            <div
              key={key}
              className={cn(
                'flex items-center gap-4 rounded-xl border p-4 transition-colors',
                isCompleted
                  ? 'border-emerald-200/60 bg-emerald-50/50'
                  : 'border-slate-200/60 bg-white',
              )}
            >
              <div
                className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all',
                  isCompleted
                    ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-sm'
                    : 'bg-slate-100',
                )}
              >
                {isCompleted ? (
                  <CheckCircle className="h-5 w-5 text-white" />
                ) : (
                  <StepIcon className="h-5 w-5 text-slate-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p
                  className={cn(
                    'text-sm font-semibold',
                    isCompleted ? 'text-emerald-800' : 'text-slate-500',
                  )}
                >
                  {label}
                </p>
                {isCompleted && (
                  <p className="text-xs text-emerald-600 font-medium mt-0.5">
                    {formatDateTime(dateValue!)}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* LI Deadline */}
      {tracking.liDeadline && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
          <div className="flex items-center gap-3">
            <Timer className="h-5 w-5 text-amber-600" />
            <div>
              <p className="text-xs font-semibold text-amber-600 uppercase tracking-wider">
                Prazo LI
              </p>
              <p className="text-sm font-bold text-amber-800 mt-0.5">
                {formatDate(tracking.liDeadline)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Notes */}
      {tracking.notes && (
        <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
          <div className="flex items-center gap-2 mb-2">
            <StickyNote className="h-4 w-4 text-slate-400" />
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Observacoes
            </p>
          </div>
          <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
            {tracking.notes}
          </p>
        </div>
      )}
    </div>
  );
}
