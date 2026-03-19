import {
  FileText,
  CheckCircle,
  AlertTriangle,
  Send,
  FileSpreadsheet,
  Upload,
  Clock,
  RefreshCw,
  MessageSquare,
  ArrowRightLeft,
  Mail,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { cn, formatDateTime, relativeTime } from '@/shared/lib/utils';

// ── Types ────────────────────────────────────────────────────────────────

export interface TimelineEvent {
  id: number | string;
  type:
    | 'status_change'
    | 'document_upload'
    | 'validation_run'
    | 'espelho_generated'
    | 'communication'
    | 'follow_up'
    | 'email_sent'
    | 'email_received'
    | 'li_update'
    | 'audit_log';
  title: string;
  description?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
  user?: string;
}

interface UnifiedTimelineProps {
  events: TimelineEvent[];
  maxItems?: number;
  className?: string;
}

// ── Icon mapping ────────────────────────────────────────────────────────

function getEventIcon(type: TimelineEvent['type']) {
  switch (type) {
    case 'status_change':
      return <ArrowRightLeft className="h-4 w-4" />;
    case 'document_upload':
      return <Upload className="h-4 w-4" />;
    case 'validation_run':
      return <ShieldCheck className="h-4 w-4" />;
    case 'espelho_generated':
      return <FileSpreadsheet className="h-4 w-4" />;
    case 'communication':
      return <MessageSquare className="h-4 w-4" />;
    case 'follow_up':
      return <RefreshCw className="h-4 w-4" />;
    case 'email_sent':
      return <Send className="h-4 w-4" />;
    case 'email_received':
      return <Mail className="h-4 w-4" />;
    case 'li_update':
      return <FileText className="h-4 w-4" />;
    case 'audit_log':
      return <Clock className="h-4 w-4" />;
    default:
      return <Clock className="h-4 w-4" />;
  }
}

function getEventColor(type: TimelineEvent['type']): string {
  switch (type) {
    case 'status_change':
      return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'document_upload':
      return 'bg-green-100 text-green-700 border-green-200';
    case 'validation_run':
      return 'bg-purple-100 text-purple-700 border-purple-200';
    case 'espelho_generated':
      return 'bg-indigo-100 text-indigo-700 border-indigo-200';
    case 'communication':
      return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'follow_up':
      return 'bg-cyan-100 text-cyan-700 border-cyan-200';
    case 'email_sent':
    case 'email_received':
      return 'bg-orange-100 text-orange-700 border-orange-200';
    case 'li_update':
      return 'bg-teal-100 text-teal-700 border-teal-200';
    case 'audit_log':
      return 'bg-slate-100 text-slate-600 border-slate-200';
    default:
      return 'bg-slate-100 text-slate-600 border-slate-200';
  }
}

// ── Component ────────────────────────────────────────────────────────────

export function UnifiedTimeline({ events, maxItems, className }: UnifiedTimelineProps) {
  const sortedEvents = [...events].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  const displayEvents = maxItems ? sortedEvents.slice(0, maxItems) : sortedEvents;

  if (displayEvents.length === 0) {
    return (
      <div
        className={cn(
          'rounded-xl border border-dashed border-slate-300 p-8 text-center',
          className,
        )}
      >
        <Clock className="h-8 w-8 text-slate-300 mx-auto mb-2" />
        <p className="text-sm text-slate-400">Nenhum evento registrado</p>
      </div>
    );
  }

  return (
    <div className={cn('relative', className)}>
      {/* Vertical line */}
      <div className="absolute left-5 top-2 bottom-2 w-px bg-slate-200" />

      <div className="space-y-4">
        {displayEvents.map((event, idx) => (
          <div key={event.id} className="relative flex items-start gap-4 pl-0">
            {/* Icon circle */}
            <div
              className={cn(
                'relative z-10 flex items-center justify-center h-10 w-10 rounded-full border-2 flex-shrink-0',
                getEventColor(event.type),
              )}
            >
              {getEventIcon(event.type)}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 pt-0.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-900 truncate">{event.title}</p>
                <time className="text-xs text-slate-400 flex-shrink-0 whitespace-nowrap">
                  {relativeTime(event.timestamp)}
                </time>
              </div>

              {event.description && (
                <p className="text-sm text-slate-500 mt-0.5">{event.description}</p>
              )}

              {event.user && <p className="text-xs text-slate-400 mt-1">por {event.user}</p>}
            </div>
          </div>
        ))}
      </div>

      {maxItems && sortedEvents.length > maxItems && (
        <div className="mt-4 text-center">
          <p className="text-xs text-slate-400">
            +{sortedEvents.length - maxItems} eventos anteriores
          </p>
        </div>
      )}
    </div>
  );
}

// ── Helper: build timeline from process data ────────────────────────────

export function buildTimelineFromProcess(process: Record<string, any>): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  // Status changes from audit logs
  if (process.auditLogs && Array.isArray(process.auditLogs)) {
    for (const log of process.auditLogs) {
      events.push({
        id: `audit-${log.id}`,
        type: log.action?.includes('status') ? 'status_change' : 'audit_log',
        title: log.action || 'Acao registrada',
        description: log.details || undefined,
        timestamp: log.createdAt,
        user: log.userName || log.userId,
      });
    }
  }

  // Documents
  if (process.documents && Array.isArray(process.documents)) {
    for (const doc of process.documents) {
      events.push({
        id: `doc-${doc.id}`,
        type: 'document_upload',
        title: `Documento enviado: ${doc.type || doc.documentType || 'Arquivo'}`,
        description: doc.originalName || doc.fileName,
        timestamp: doc.createdAt || doc.uploadedAt,
        user: doc.uploadedBy,
      });
    }
  }

  // Validation runs
  if (process.validationRuns && Array.isArray(process.validationRuns)) {
    for (const run of process.validationRuns) {
      const passedCount = run.results?.filter((r: any) => r.status === 'passed').length ?? 0;
      const failedCount = run.results?.filter((r: any) => r.status === 'failed').length ?? 0;
      events.push({
        id: `val-${run.id}`,
        type: 'validation_run',
        title: `Validacao executada`,
        description: `${passedCount} aprovados, ${failedCount} falhas`,
        timestamp: run.createdAt || run.runAt,
        user: run.triggeredBy,
      });
    }
  }

  // Espelhos
  if (process.espelhos && Array.isArray(process.espelhos)) {
    for (const espelho of process.espelhos) {
      events.push({
        id: `esp-${espelho.id}`,
        type: 'espelho_generated',
        title: 'Espelho gerado',
        description: espelho.version ? `Versao ${espelho.version}` : undefined,
        timestamp: espelho.createdAt || espelho.generatedAt,
        user: espelho.generatedBy,
      });
    }
  }

  // Communications
  if (process.communications && Array.isArray(process.communications)) {
    for (const comm of process.communications) {
      events.push({
        id: `comm-${comm.id}`,
        type: comm.direction === 'sent' ? 'email_sent' : 'email_received',
        title: comm.subject || 'Comunicacao',
        description: comm.recipientType || comm.from,
        timestamp: comm.createdAt || comm.sentAt,
        user: comm.sentBy,
      });
    }
  }

  // Follow-up updates
  if (process.followUp) {
    const fup = process.followUp;
    const fupFields: Array<[string, string]> = [
      ['documentsReceivedAt', 'Documentos recebidos (FUP)'],
      ['preInspectionAt', 'Pre-inspecao registrada'],
      ['ncmVerifiedAt', 'NCM verificado'],
      ['espelhoGeneratedAt', 'Espelho gerado (FUP)'],
      ['sentToFeniciaAt', 'Enviado para Fenicia (FUP)'],
      ['liSubmittedAt', 'LI submetida'],
    ];

    for (const [field, title] of fupFields) {
      if (fup[field]) {
        events.push({
          id: `fup-${field}`,
          type: 'follow_up',
          title,
          timestamp: fup[field],
        });
      }
    }
  }

  return events;
}
