import { useState } from 'react';
import {
  FileUp,
  ClipboardCheck,
  Mail,
  ArrowRight,
  Ship,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  History,
  User,
} from 'lucide-react';
import { useApiQuery } from '@/shared/hooks/useApi';
import { cn, relativeTime } from '@/shared/lib/utils';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import type { ProcessEvent } from '@/shared/types';

interface ProcessTimelineEventsProps {
  processId: string;
}

const EVENT_CONFIG: Record<
  string,
  { icon: typeof FileUp; color: string; bgColor: string; borderColor: string }
> = {
  document_uploaded: {
    icon: FileUp,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
  },
  validation_run: {
    icon: ClipboardCheck,
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-200',
  },
  correction_needed: {
    icon: AlertTriangle,
    color: 'text-red-600',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
  },
  email_sent: {
    icon: Mail,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-200',
  },
  status_changed: {
    icon: ArrowRight,
    color: 'text-amber-600',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
  },
  logistic_status_changed: {
    icon: Ship,
    color: 'text-cyan-600',
    bgColor: 'bg-cyan-50',
    borderColor: 'border-cyan-200',
  },
};

const DEFAULT_CONFIG = {
  icon: History,
  color: 'text-slate-600',
  bgColor: 'bg-slate-50',
  borderColor: 'border-slate-200',
};

function EventMetadata({ metadata }: { metadata: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);

  const entries = Object.entries(metadata).filter(([, v]) => v != null && v !== '');
  if (entries.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Detalhes
      </button>
      {expanded && (
        <div className="mt-1.5 rounded-lg bg-slate-50/80 border border-slate-100 p-2.5 text-xs text-slate-600 space-y-1">
          {entries.map(([key, value]) => (
            <div key={key} className="flex gap-2">
              <span className="font-medium text-slate-500 min-w-[80px]">{key}:</span>
              <span className="text-slate-700 break-all">
                {typeof value === 'object' ? JSON.stringify(value) : String(value)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProcessTimelineEvents({ processId }: ProcessTimelineEventsProps) {
  const { data: events, isLoading } = useApiQuery<ProcessEvent[]>(
    ['process-events', processId],
    `/api/processes/${processId}/events?limit=50`,
    { staleTime: 30_000 },
  );

  if (isLoading) {
    return <LoadingSpinner className="py-6" />;
  }

  if (!events || events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
          <History className="h-6 w-6 text-slate-300" />
        </div>
        <p className="text-sm text-slate-400 font-medium">Nenhum evento registrado ainda.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <History className="h-5 w-5 text-slate-400" />
        <h3 className="text-lg font-bold text-slate-800">Historico de Eventos</h3>
        <span className="text-xs font-medium text-slate-400 bg-slate-100 rounded-full px-2 py-0.5">
          {events.length}
        </span>
      </div>

      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-5 top-3 bottom-3 w-px bg-slate-200" />

        <div className="space-y-3">
          {events.map((event) => {
            const config = EVENT_CONFIG[event.eventType] || DEFAULT_CONFIG;
            const Icon = config.icon;

            return (
              <div key={event.id} className="relative flex gap-4 pl-1">
                {/* Icon circle */}
                <div
                  className={cn(
                    'relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border',
                    config.bgColor,
                    config.borderColor,
                  )}
                >
                  <Icon className={cn('h-4 w-4', config.color)} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 pb-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-700 leading-snug">
                      {event.title}
                    </p>
                    <span className="shrink-0 text-xs text-slate-400 font-medium whitespace-nowrap">
                      {relativeTime(event.createdAt)}
                    </span>
                  </div>

                  {event.description && (
                    <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                      {event.description}
                    </p>
                  )}

                  {event.userName && (
                    <div className="flex items-center gap-1 mt-1 text-xs text-slate-400">
                      <User className="h-3 w-3" />
                      <span>{event.userName}</span>
                    </div>
                  )}

                  {event.metadata && (
                    <EventMetadata metadata={event.metadata as Record<string, unknown>} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
