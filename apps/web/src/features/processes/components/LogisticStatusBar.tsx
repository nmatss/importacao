import { useState } from 'react';
import {
  Factory,
  Package,
  Clock,
  Ship,
  ArrowRightLeft,
  Anchor,
  FileCheck,
  Truck,
  Warehouse,
  Check,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { LOGISTIC_STAGES } from '@/shared/lib/constants';
import type { ImportProcess } from '@/shared/types';

// ── Icon map ─────────────────────────────────────────────────────────────

const ICON_MAP = {
  Factory,
  Package,
  Clock,
  Ship,
  ArrowRightLeft,
  Anchor,
  FileCheck,
  Truck,
  Warehouse,
} as const;

// ── Props ────────────────────────────────────────────────────────────────

export interface LogisticStatusBarProps {
  currentStatus: string;
  etd?: string | null;
  eta?: string | null;
  etaActual?: string | null;
  customsClearanceAt?: string | null;
  cdArrivalAt?: string | null;
  shipmentDate?: string | null;
  customsChannel?: string | null;
  hasDocuments?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function isPastDate(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  return new Date(dateStr) <= new Date();
}

function formatDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
    });
  } catch {
    return null;
  }
}

/**
 * Derive the current logistic step index (0-based) from process fields.
 */
export function deriveLogisticStep(props: LogisticStatusBarProps): number {
  const {
    cdArrivalAt,
    customsClearanceAt,
    customsChannel,
    etaActual,
    shipmentDate,
    etd,
    hasDocuments,
  } = props;

  if (cdArrivalAt) return 8; // Entregue no CD
  if (customsClearanceAt) return 7; // Transporte Interno
  if (customsChannel) return 6; // Desembaraco
  if (etaActual) return 5; // Chegada no Porto

  if (shipmentDate) {
    // If there's a shipment date, check if it could be in transshipment
    // For now, mark as shipped (index 3). Transshipment (4) would need explicit data.
    return 3;
  }

  if (etd) {
    if (isPastDate(etd)) return 3; // Embarcado (ETD passed)
    return 2; // Aguardando Embarque
  }

  if (hasDocuments) return 1; // Consolidacao

  return 0; // Em Producao
}

/**
 * Get a date label for a given stage index, if available.
 */
function getStageDate(index: number, props: LogisticStatusBarProps): string | null {
  switch (index) {
    case 2:
      return formatDate(props.etd); // Ag. Embarque → ETD
    case 3:
      return formatDate(props.shipmentDate ?? props.etd);
    case 5:
      return formatDate(props.etaActual ?? props.eta);
    case 6:
      return formatDate(props.customsClearanceAt);
    case 8:
      return formatDate(props.cdArrivalAt);
    default:
      return null;
  }
}

// ── Component ────────────────────────────────────────────────────────────

export function LogisticStatusBar(props: LogisticStatusBarProps) {
  const currentStep = deriveLogisticStep(props);
  const [mobileIndex, setMobileIndex] = useState(currentStep);

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
      <div className="px-4 pt-2.5 pb-0">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
          Ciclo de Transporte
        </p>
      </div>
      {/* Desktop / Tablet view */}
      <div className="hidden md:block px-4 py-3">
        <div className="flex items-center">
          {LOGISTIC_STAGES.map((stage, idx) => {
            const Icon = ICON_MAP[stage.icon as keyof typeof ICON_MAP];
            const isCompleted = idx < currentStep;
            const isActive = idx === currentStep;
            const isFuture = idx > currentStep;
            const date = getStageDate(idx, props);

            return (
              <div key={stage.key} className="flex items-center flex-1 min-w-0">
                {/* Step circle + label */}
                <div className="flex flex-col items-center gap-1 min-w-0 flex-shrink-0 w-full">
                  <div
                    className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-full transition-all',
                      isCompleted && 'bg-emerald-100 text-emerald-600 ring-2 ring-emerald-200',
                      isActive &&
                        'bg-blue-600 text-white ring-2 ring-blue-300 shadow-md shadow-blue-200',
                      isFuture && 'bg-slate-100 text-slate-400',
                    )}
                  >
                    {isCompleted ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                  </div>
                  <span
                    className={cn(
                      'text-[10px] font-semibold text-center leading-tight truncate max-w-full px-0.5',
                      isCompleted && 'text-emerald-700',
                      isActive && 'text-blue-700',
                      isFuture && 'text-slate-400',
                    )}
                  >
                    {stage.label}
                  </span>
                  {date && (
                    <span
                      className={cn(
                        'text-[9px] tabular-nums',
                        isCompleted
                          ? 'text-emerald-500'
                          : isActive
                            ? 'text-blue-500'
                            : 'text-slate-300',
                      )}
                    >
                      {date}
                    </span>
                  )}
                </div>

                {/* Connector line */}
                {idx < LOGISTIC_STAGES.length - 1 && (
                  <div
                    className={cn(
                      'h-0.5 flex-1 mx-1 rounded-full min-w-2',
                      idx < currentStep ? 'bg-emerald-300' : 'bg-slate-200',
                    )}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile view: show active step with arrows */}
      <div className="md:hidden flex items-center justify-between px-4 py-3">
        <button
          onClick={() => setMobileIndex((prev) => Math.max(0, prev - 1))}
          disabled={mobileIndex === 0}
          className="p-1 rounded-lg hover:bg-slate-100 disabled:opacity-30 transition-colors"
        >
          <ChevronLeft className="h-5 w-5 text-slate-500" />
        </button>

        <div className="flex flex-col items-center gap-1 flex-1">
          {/* Progress dots */}
          <div className="flex gap-1 mb-1">
            {LOGISTIC_STAGES.map((_, idx) => (
              <div
                key={idx}
                className={cn(
                  'h-1.5 w-1.5 rounded-full transition-colors',
                  idx < currentStep && 'bg-emerald-400',
                  idx === currentStep && 'bg-blue-500',
                  idx > currentStep && 'bg-slate-200',
                  idx === mobileIndex && 'ring-2 ring-offset-1 ring-blue-300',
                )}
              />
            ))}
          </div>

          {(() => {
            const stage = LOGISTIC_STAGES[mobileIndex];
            const Icon = ICON_MAP[stage.icon as keyof typeof ICON_MAP];
            const isCompleted = mobileIndex < currentStep;
            const isActive = mobileIndex === currentStep;
            const date = getStageDate(mobileIndex, props);

            return (
              <>
                <div
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-full',
                    isCompleted && 'bg-emerald-100 text-emerald-600',
                    isActive && 'bg-blue-600 text-white shadow-md shadow-blue-200',
                    !isCompleted && !isActive && 'bg-slate-100 text-slate-400',
                  )}
                >
                  {isCompleted ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                </div>
                <span
                  className={cn(
                    'text-xs font-semibold',
                    isCompleted
                      ? 'text-emerald-700'
                      : isActive
                        ? 'text-blue-700'
                        : 'text-slate-400',
                  )}
                >
                  {stage.label}
                </span>
                {date && <span className="text-[10px] text-slate-400 tabular-nums">{date}</span>}
              </>
            );
          })()}
        </div>

        <button
          onClick={() => setMobileIndex((prev) => Math.min(LOGISTIC_STAGES.length - 1, prev + 1))}
          disabled={mobileIndex === LOGISTIC_STAGES.length - 1}
          className="p-1 rounded-lg hover:bg-slate-100 disabled:opacity-30 transition-colors"
        >
          <ChevronRight className="h-5 w-5 text-slate-500" />
        </button>
      </div>
    </div>
  );
}

/** Build LogisticStatusBar props from an ImportProcess object. */
export function buildLogisticProps(process: ImportProcess): LogisticStatusBarProps {
  return {
    currentStatus: process.status,
    etd: process.etd,
    eta: process.eta,
    etaActual: (process as unknown as Record<string, unknown>).etaActual as
      | string
      | null
      | undefined,
    customsClearanceAt: (process as unknown as Record<string, unknown>).customsClearanceAt as
      | string
      | null
      | undefined,
    cdArrivalAt: (process as unknown as Record<string, unknown>).cdArrivalAt as
      | string
      | null
      | undefined,
    shipmentDate: process.shipmentDate,
    customsChannel: process.customsChannel,
    hasDocuments: (process.documents ?? []).length > 0,
  };
}
