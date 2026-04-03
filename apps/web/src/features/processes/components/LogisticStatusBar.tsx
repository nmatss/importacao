import { useState, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import {
  Package,
  Clock,
  Ship,
  Anchor,
  FileCheck,
  Search,
  ShieldCheck,
  Truck,
  Warehouse,
  CheckCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Pencil,
  X,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/shared/lib/utils';
import { LOGISTIC_STAGES } from '@/shared/lib/constants';
import { api } from '@/shared/lib/api-client';
import type { ImportProcess } from '@/shared/types';

// ── Icon map ─────────────────────────────────────────────────────────────

const ICON_MAP = {
  Package,
  Clock,
  Ship,
  Anchor,
  FileCheck,
  Search,
  ShieldCheck,
  Truck,
  Warehouse,
  CheckCircle,
} as const;

// ── Props ────────────────────────────────────────────────────────────────

export interface LogisticStatusBarProps {
  processId: number;
  currentStatus: string;
  logisticStatus?: string | null;
  etd?: string | null;
  eta?: string | null;
  etaActual?: string | null;
  customsClearanceAt?: string | null;
  cdArrivalAt?: string | null;
  shipmentDate?: string | null;
  customsChannel?: string | null;
  diNumber?: string | null;
  inspectionType?: string | null;
  portOfDischarge?: string | null;
  notes?: string | null;
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
 * Map stage keys to indices for quick lookup.
 */
const STAGE_INDEX_MAP = Object.fromEntries(LOGISTIC_STAGES.map((s, i) => [s.key, i])) as Record<
  string,
  number
>;

/**
 * Derive the current logistic step index (0-based) from process fields.
 * Manual override via logisticStatus takes priority.
 */
export function deriveLogisticStep(props: LogisticStatusBarProps): number {
  // Manual override takes priority
  if (props.logisticStatus && STAGE_INDEX_MAP[props.logisticStatus] !== undefined) {
    return STAGE_INDEX_MAP[props.logisticStatus];
  }

  const {
    cdArrivalAt,
    customsClearanceAt,
    customsChannel,
    diNumber,
    inspectionType,
    etaActual,
    eta,
    shipmentDate,
    etd,
    notes,
  } = props;

  // 10: Internalizado — cdArrivalAt + notes contain "NF" or "internalizado"
  if (cdArrivalAt && notes && (/\bNF\b/i.test(notes) || /internalizado/i.test(notes))) {
    return 10;
  }

  // 9: Ag. Entrada — cdArrivalAt exists
  if (cdArrivalAt) return 9;

  // 8: Em Viagem CD — customsClearanceAt exists and no cdArrivalAt
  // 7: Ag. Carregamento — customsClearanceAt exists (same, manual override differentiates)
  // 6: Lib. Portuaria — customsClearanceAt exists
  if (customsClearanceAt) return 8;

  // 5: Conf. Aduaneira — customsChannel + inspectionType
  if (customsChannel && inspectionType) return 5;

  // 4: Registrado — diNumber or customsChannel exists
  if (diNumber || customsChannel) return 4;

  // 3: Em Atracacao — etaActual or (eta is past)
  if (etaActual || (eta && isPastDate(eta))) return 3;

  // 2: Em Transito — shipmentDate or (etd is past)
  if (shipmentDate || (etd && isPastDate(etd))) return 2;

  // 1: Ag. Embarque — etd exists and is future
  if (etd && !isPastDate(etd)) return 1;

  // 0: Em Consolidacao — default
  return 0;
}

/**
 * Get sub-info elements for a given stage index.
 */
function getStageSubInfo(
  index: number,
  props: LogisticStatusBarProps,
): { text: string; badge?: { label: string; color: string } } | null {
  switch (index) {
    case 1: {
      // Ag. Embarque → ETD
      const d = formatDate(props.etd);
      return d ? { text: `ETD: ${d}` } : null;
    }
    case 3: {
      // Em Atracacao → Porto + ETA
      const parts: string[] = [];
      if (props.portOfDischarge) parts.push(props.portOfDischarge);
      const d = formatDate(props.etaActual ?? props.eta);
      if (d) parts.push(`ETA: ${d}`);
      return parts.length > 0 ? { text: parts.join(' | ') } : null;
    }
    case 4: {
      // Registrado → DUIMP + Canal badge
      const parts: string[] = [];
      if (props.diNumber) parts.push(props.diNumber);
      const channel = props.customsChannel?.toLowerCase();
      let badge: { label: string; color: string } | undefined;
      if (channel === 'verde') badge = { label: 'Verde', color: 'bg-emerald-100 text-emerald-700' };
      else if (channel === 'amarelo')
        badge = { label: 'Amarelo', color: 'bg-amber-100 text-amber-700' };
      else if (channel === 'vermelho')
        badge = { label: 'Vermelho', color: 'bg-danger-100 text-danger-700' };
      else if (channel)
        badge = { label: props.customsChannel!, color: 'bg-slate-100 text-slate-600' };
      return parts.length > 0 || badge ? { text: parts.join(''), badge } : null;
    }
    case 5: {
      // Conf. Aduaneira → Orgao
      if (props.inspectionType) return { text: props.inspectionType };
      return null;
    }
    case 9: {
      // Ag. Entrada → date
      const d = formatDate(props.cdArrivalAt);
      return d ? { text: d } : null;
    }
    default:
      return null;
  }
}

// ── Edit Dropdown ────────────────────────────────────────────────────────

function StatusDropdown({
  processId,
  currentStepKey,
  onClose,
}: {
  processId: number;
  currentStepKey: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const handleSelect = async (key: string) => {
    if (key === currentStepKey) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/api/processes/${processId}`, { logisticStatus: key });
      toast.success('Status logistico atualizado');
      queryClient.invalidateQueries({ queryKey: ['process', String(processId)] });
      onClose();
    } catch {
      toast.error('Erro ao atualizar status');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      ref={dropdownRef}
      className="absolute top-full right-0 z-50 mt-1 w-56 rounded-lg border border-slate-200 bg-white shadow-lg py-1 max-h-72 overflow-y-auto"
    >
      <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
        <span>Alterar Status</span>
        <button onClick={onClose} className="p-0.5 hover:bg-slate-100 rounded">
          <X className="h-3 w-3" />
        </button>
      </div>
      {LOGISTIC_STAGES.map((stage) => (
        <button
          key={stage.key}
          onClick={() => handleSelect(stage.key)}
          disabled={saving}
          className={cn(
            'w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 transition-colors flex items-center gap-2',
            stage.key === currentStepKey && 'bg-primary-50 text-primary-700 font-semibold',
            saving && 'opacity-50 cursor-wait',
          )}
        >
          {(() => {
            const Icon = ICON_MAP[stage.icon as keyof typeof ICON_MAP];
            return Icon ? <Icon className="h-3.5 w-3.5 shrink-0" /> : null;
          })()}
          <span>{stage.label}</span>
          {stage.key === currentStepKey && <Check className="h-3 w-3 ml-auto" />}
        </button>
      ))}
    </div>
  );
}

// ── Sub Info Renderer ────────────────────────────────────────────────────

function SubInfoDisplay({
  info,
}: {
  info: { text: string; badge?: { label: string; color: string } } | null;
}) {
  if (!info) return null;
  return (
    <div className="flex items-center gap-1 flex-wrap justify-center">
      {info.text && <span className="text-[9px] tabular-nums leading-tight">{info.text}</span>}
      {info.badge && (
        <span
          className={cn(
            'text-[8px] font-bold px-1.5 py-0.5 rounded-full leading-none',
            info.badge.color,
          )}
        >
          {info.badge.label}
        </span>
      )}
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────

export function LogisticStatusBar(props: LogisticStatusBarProps) {
  const currentStep = deriveLogisticStep(props);
  const [mobileIndex, setMobileIndex] = useState(currentStep);
  const [showDropdown, setShowDropdown] = useState(false);

  const currentStepKey = LOGISTIC_STAGES[currentStep].key;

  return (
    <div className="rounded-2xl border border-slate-200/60 bg-white shadow-sm overflow-hidden">
      <div className="px-4 pt-2.5 pb-0 flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
          Ciclo de Transporte
        </p>
        <div className="relative">
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <Pencil className="h-3 w-3" />
            editar
          </button>
          {showDropdown && (
            <StatusDropdown
              processId={props.processId}
              currentStepKey={currentStepKey}
              onClose={() => setShowDropdown(false)}
            />
          )}
        </div>
      </div>

      {/* Desktop / Tablet view */}
      <div className="hidden md:block px-4 py-3">
        <div className="flex items-center">
          {LOGISTIC_STAGES.map((stage, idx) => {
            const Icon = ICON_MAP[stage.icon as keyof typeof ICON_MAP];
            const isCompleted = idx < currentStep;
            const isActive = idx === currentStep;
            const isFuture = idx > currentStep;
            const subInfo = isCompleted || isActive ? getStageSubInfo(idx, props) : null;

            return (
              <div key={stage.key} className="flex items-center flex-1 min-w-0">
                {/* Step circle + label */}
                <div className="flex flex-col items-center gap-1 min-w-0 flex-shrink-0 w-full">
                  <div
                    className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-full transition-all',
                      isCompleted && 'bg-emerald-100 text-emerald-600 ring-2 ring-emerald-200',
                      isActive && 'bg-primary-600 text-white ring-2 ring-primary-300 shadow-sm',
                      isFuture && 'bg-slate-100 text-slate-400',
                    )}
                  >
                    {isCompleted ? (
                      <Check className="h-4 w-4" />
                    ) : Icon ? (
                      <Icon className="h-4 w-4" />
                    ) : (
                      <Package className="h-4 w-4" />
                    )}
                  </div>
                  <span
                    className={cn(
                      'text-[10px] font-semibold text-center leading-tight truncate max-w-full px-0.5',
                      isCompleted && 'text-emerald-700',
                      isActive && 'text-primary-700',
                      isFuture && 'text-slate-400',
                    )}
                  >
                    {stage.label}
                  </span>
                  {subInfo && (
                    <div
                      className={cn(
                        isCompleted
                          ? 'text-emerald-500'
                          : isActive
                            ? 'text-primary-500'
                            : 'text-slate-300',
                      )}
                    >
                      <SubInfoDisplay info={subInfo} />
                    </div>
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
                  idx === currentStep && 'bg-primary-500',
                  idx > currentStep && 'bg-slate-200',
                  idx === mobileIndex && 'ring-2 ring-offset-1 ring-primary-300',
                )}
              />
            ))}
          </div>

          {(() => {
            const stage = LOGISTIC_STAGES[mobileIndex];
            const Icon = ICON_MAP[stage.icon as keyof typeof ICON_MAP];
            const isCompleted = mobileIndex < currentStep;
            const isActive = mobileIndex === currentStep;
            const subInfo = isCompleted || isActive ? getStageSubInfo(mobileIndex, props) : null;

            return (
              <>
                <div
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-full',
                    isCompleted && 'bg-emerald-100 text-emerald-600',
                    isActive && 'bg-primary-600 text-white shadow-sm',
                    !isCompleted && !isActive && 'bg-slate-100 text-slate-400',
                  )}
                >
                  {isCompleted ? (
                    <Check className="h-5 w-5" />
                  ) : Icon ? (
                    <Icon className="h-5 w-5" />
                  ) : (
                    <Package className="h-5 w-5" />
                  )}
                </div>
                <span
                  className={cn(
                    'text-xs font-semibold',
                    isCompleted
                      ? 'text-emerald-700'
                      : isActive
                        ? 'text-primary-700'
                        : 'text-slate-400',
                  )}
                >
                  {stage.label}
                </span>
                {subInfo && (
                  <div className="text-[10px] text-slate-500">
                    <SubInfoDisplay info={subInfo} />
                  </div>
                )}
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
    processId: process.id,
    currentStatus: process.status,
    logisticStatus: process.logisticStatus,
    etd: process.etd,
    eta: process.eta,
    etaActual: process.etaActual,
    customsClearanceAt: process.customsClearanceAt,
    cdArrivalAt: process.cdArrivalAt,
    shipmentDate: process.shipmentDate,
    customsChannel: process.customsChannel,
    diNumber: process.diNumber,
    inspectionType: process.inspectionType,
    portOfDischarge: process.portOfDischarge,
    notes: process.notes,
    hasDocuments: (process.documents ?? []).length > 0,
  };
}
