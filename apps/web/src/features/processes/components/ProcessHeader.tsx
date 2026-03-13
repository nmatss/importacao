import {
  ArrowLeft,
  Edit,
  ExternalLink,
  AlertTriangle,
  BadgeCheck,
} from 'lucide-react';
import { cn, formatDate } from '@/shared/lib/utils';
import { StatusBadge } from '@/shared/components/StatusBadge';
import type { ImportProcess } from '@/shared/types';

export interface ProcessHeaderProps {
  process: ImportProcess;
  processId: string;
  onBack: () => void;
  onEdit: () => void;
}

function ProcessFlags({ process }: { process: ImportProcess }) {
  const flags = [
    { active: process.hasLiItems, label: 'LI', color: 'bg-purple-100 text-purple-700 border-purple-200' },
    { active: process.hasCertification, label: 'Certificacao', color: 'bg-orange-100 text-orange-700 border-orange-200' },
    { active: process.hasFreeOfCharge, label: 'FOC', color: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  ].filter(f => f.active);

  if (flags.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {flags.map((f) => (
        <span key={f.label} className={cn('inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold', f.color)}>
          <BadgeCheck className="h-3.5 w-3.5" />
          {f.label}
        </span>
      ))}
    </div>
  );
}

export function ProcessHeader({ process, processId, onBack, onEdit }: ProcessHeaderProps) {
  const docCounts = {
    total: process.documents?.length ?? 0,
    processed: process.documents?.filter(d => d.isProcessed).length ?? 0,
  };

  return (
    <>
      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 hover:border-slate-300 transition-all shadow-sm"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
                {process.processCode}
              </h2>
              <span className="inline-flex items-center rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold capitalize text-slate-600 tracking-wide">
                {process.brand}
              </span>
              <StatusBadge status={process.status} />
              {process.correctionStatus && (
                <span className="inline-flex items-center gap-1 rounded-lg bg-amber-100 border border-amber-200 px-2.5 py-1 text-xs font-semibold text-amber-700">
                  <AlertTriangle className="h-3 w-3" />
                  {process.correctionStatus}
                </span>
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-3 text-sm text-slate-400">
              <span>Criado em {formatDate(process.createdAt)}</span>
              {process.etd && (
                <>
                  <span className="h-1 w-1 rounded-full bg-slate-300" />
                  <span>ETD: <span className="text-slate-600 font-medium">{formatDate(process.etd)}</span></span>
                </>
              )}
              {process.eta && (
                <>
                  <span className="h-1 w-1 rounded-full bg-slate-300" />
                  <span>ETA: <span className="text-slate-600 font-medium">{formatDate(process.eta)}</span></span>
                </>
              )}
              <span className="h-1 w-1 rounded-full bg-slate-300" />
              <span>{docCounts.total} doc{docCounts.total !== 1 ? 's' : ''} ({docCounts.processed} processado{docCounts.processed !== 1 ? 's' : ''})</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          {process.driveFolderId && (
            <a
              href={`https://drive.google.com/drive/folders/${process.driveFolderId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 hover:border-emerald-300 transition-all shadow-sm"
            >
              <ExternalLink className="h-4 w-4" />
              Abrir no Drive
            </a>
          )}
          {process.sistemaDriveFolderId && (
            <a
              href={`https://drive.google.com/drive/folders/${process.sistemaDriveFolderId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-100 hover:border-blue-300 transition-all shadow-sm"
            >
              <ExternalLink className="h-4 w-4" />
              Sistema Automatico
            </a>
          )}
          <button
            onClick={onEdit}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm"
          >
            <Edit className="h-4 w-4" />
            Editar
          </button>
        </div>
      </div>

      {/* Flags */}
      <ProcessFlags process={process} />
    </>
  );
}
