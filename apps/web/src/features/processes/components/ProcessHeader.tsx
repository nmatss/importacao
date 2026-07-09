import {
  ArrowLeft,
  Edit,
  ExternalLink,
  AlertTriangle,
  BadgeCheck,
  Lock,
  Unlock,
  Save,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cn, formatDate } from '@/shared/lib/utils';
import { StatusBadge } from '@/shared/components/StatusBadge';
import { ConfirmDialog } from '@/shared/components/ConfirmDialog';
import { api } from '@/shared/lib/api-client';
import { getErrorMessage } from '@/shared/utils/errors';
import type { ImportProcess } from '@/shared/types';

const MIN_OPERATIONAL_CONFIDENCE = 0.4;

export interface ProcessHeaderProps {
  process: ImportProcess;
  processId: string;
  onBack: () => void;
  onEdit: () => void;
}

function ProcessFlags({ process }: { process: ImportProcess }) {
  const flags = [
    {
      active: process.hasLiItems,
      label: 'LI',
      color:
        'bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-700',
    },
    {
      active: process.hasCertification,
      label: 'Certificacao',
      color:
        'bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-700',
    },
    {
      active: process.hasFreeOfCharge,
      label: 'FOC',
      color:
        'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-700',
    },
  ].filter((f) => f.active);

  if (flags.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {flags.map((f) => (
        <span
          key={f.label}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold',
            f.color,
          )}
        >
          <BadgeCheck className="h-3.5 w-3.5" />
          {f.label}
        </span>
      ))}
    </div>
  );
}

function hasUsefulExtraction(doc: ImportProcess['documents'][number]) {
  const data = doc.aiParsedData;
  if (!doc.isProcessed || !data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (data.extractionFailed || data.error || data.skipped) return false;
  if (!hasOperationalConfidence(doc.confidenceScore)) return false;

  const metaKeys = new Set([
    'budgetExceeded',
    'confidence',
    'confidenceScore',
    'error',
    'extractionFailed',
    'fieldsWithLowConfidence',
    'reason',
    'rawText',
    'skipped',
    'source',
    '_trust',
    'warnings',
  ]);

  const hasValue = (value: unknown): boolean => {
    if (value == null) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'boolean') return value === true;
    if (Array.isArray(value)) return value.some((item) => hasValue(item));
    if (typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    if ('value' in record) return hasValue(record.value);
    return Object.entries(record).some(([key, nested]) => !metaKeys.has(key) && hasValue(nested));
  };

  return hasValue(data);
}

function hasOperationalConfidence(confidenceScore: string | number | null | undefined): boolean {
  if (confidenceScore == null) return true;
  const confidence =
    typeof confidenceScore === 'number' ? confidenceScore : Number.parseFloat(confidenceScore);
  return Number.isFinite(confidence) && confidence >= MIN_OPERATIONAL_CONFIDENCE;
}

/**
 * Read a date field from the BL espelho summary projected by the backend
 * (process.aiExtractedData.espelho.summary.{etd,eta}). Used as a subtle
 * fallback for the header subtitle — same source the info card relies on.
 */
function readEspelhoSummaryDate(process: ImportProcess, key: 'etd' | 'eta'): string | null {
  const aiData = process.aiExtractedData;
  if (!aiData || typeof aiData !== 'object' || Array.isArray(aiData)) return null;
  const espelho = (aiData as Record<string, unknown>).espelho;
  if (!espelho || typeof espelho !== 'object' || Array.isArray(espelho)) return null;
  const summary = (espelho as Record<string, unknown>).summary;
  const source =
    summary && typeof summary === 'object' && !Array.isArray(summary)
      ? (summary as Record<string, unknown>)
      : (espelho as Record<string, unknown>);
  const value = source[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

export function ProcessHeader({ process, processId, onBack, onEdit }: ProcessHeaderProps) {
  const docCounts = {
    total: process.documents?.length ?? 0,
    extracted: process.documents?.filter(hasUsefulExtraction).length ?? 0,
  };
  const etd = process.etd ?? readEspelhoSummaryDate(process, 'etd');
  const eta = process.eta ?? readEspelhoSummaryDate(process, 'eta');
  const queryClient = useQueryClient();
  const [showUnlockConfirm, setShowUnlockConfirm] = useState(false);
  const [urgentNote, setUrgentNote] = useState(process.urgentNote ?? '');
  const [savingUrgentNote, setSavingUrgentNote] = useState(false);

  useEffect(() => {
    setUrgentNote(process.urgentNote ?? '');
  }, [process.urgentNote]);

  const handleUnlock = async () => {
    setShowUnlockConfirm(false);
    const token = localStorage.getItem('importacao_token');
    const baseUrl = import.meta.env.VITE_API_URL || '';
    try {
      const res = await fetch(`${baseUrl}/api/processes/${processId}/unlock`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`Falha ao destravar (${res.status})`);
      toast.success('Processo destravado');
      queryClient.invalidateQueries({ queryKey: ['process', processId] });
    } catch (err: any) {
      toast.error(err.message || 'Erro ao destravar');
    }
  };

  const saveUrgentNote = async () => {
    setSavingUrgentNote(true);
    try {
      await api.put(`/api/processes/${processId}`, { urgentNote: urgentNote.trim() || null });
      toast.success('Observacao urgente salva');
      queryClient.invalidateQueries({ queryKey: ['process', processId] });
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setSavingUrgentNote(false);
    }
  };

  return (
    <>
      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-900 hover:text-slate-700 dark:text-slate-300 hover:border-slate-300 transition-all shadow-sm"
            aria-label="Voltar para lista de processos"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
                {process.processCode}
              </h2>
              <span className="inline-flex items-center rounded-lg bg-slate-100 dark:bg-slate-700 px-2.5 py-1 text-xs font-semibold capitalize text-slate-600 dark:text-slate-400 tracking-wide">
                {process.brand}
              </span>
              <StatusBadge status={process.status} />
              {process.correctionStatus && (
                <span className="inline-flex items-center gap-1 rounded-lg bg-amber-100 dark:bg-amber-900/50 border border-amber-200 dark:border-amber-700 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-3 w-3" />
                  {process.correctionStatus}
                </span>
              )}
              {process.lockedAt && (
                <span
                  className="inline-flex items-center gap-1 rounded-lg bg-slate-200 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:text-slate-300"
                  title={`Travado em ${formatDate(process.lockedAt)} (${process.lockedReason ?? 'sem motivo'})`}
                >
                  <Lock className="h-3 w-3" />
                  Travado
                </span>
              )}
              {process.previousCodes && process.previousCodes.length > 0 && (
                <span
                  className="inline-flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-[11px] font-mono text-slate-500 dark:text-slate-400"
                  title={`Códigos anteriores: ${process.previousCodes.join(', ')}`}
                >
                  ex.: {process.previousCodes[process.previousCodes.length - 1]}
                </span>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 sm:gap-3 text-xs sm:text-sm text-slate-400">
              <span>Criado em {formatDate(process.createdAt)}</span>
              {etd && (
                <>
                  <span className="hidden sm:block h-1 w-1 rounded-full bg-slate-300 dark:bg-slate-600" />
                  <span>
                    ETD:{' '}
                    <span className="text-slate-600 dark:text-slate-400 font-medium">
                      {formatDate(etd)}
                    </span>
                  </span>
                </>
              )}
              {eta && (
                <>
                  <span className="hidden sm:block h-1 w-1 rounded-full bg-slate-300 dark:bg-slate-600" />
                  <span>
                    ETA:{' '}
                    <span className="text-slate-600 dark:text-slate-400 font-medium">
                      {formatDate(eta)}
                    </span>
                  </span>
                </>
              )}
              <span className="hidden sm:block h-1 w-1 rounded-full bg-slate-300 dark:bg-slate-600" />
              <span>
                {docCounts.total} doc{docCounts.total !== 1 ? 's' : ''} ({docCounts.extracted}{' '}
                extraido{docCounts.extracted !== 1 ? 's' : ''})
              </span>
            </div>
            <div className="mt-3 flex max-w-3xl flex-col gap-2 sm:flex-row sm:items-start">
              <textarea
                value={urgentNote}
                onChange={(event) => setUrgentNote(event.target.value)}
                rows={1}
                placeholder="Observacao urgente"
                className="min-h-[42px] flex-1 resize-y rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 placeholder:text-red-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 dark:border-red-700 dark:bg-red-950/40 dark:text-red-200 dark:placeholder:text-red-500"
              />
              <button
                type="button"
                onClick={saveUrgentNote}
                disabled={savingUrgentNote || urgentNote === (process.urgentNote ?? '')}
                className="inline-flex h-[42px] items-center justify-center gap-1.5 rounded-lg border border-red-300 bg-red-600 px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-700"
              >
                <Save className="h-3.5 w-3.5" />
                Salvar
              </button>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {process.driveFolderId && (
            <a
              href={`https://drive.google.com/drive/folders/${process.driveFolderId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 sm:gap-2 rounded-xl border border-emerald-200 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 px-3 py-2 sm:px-4 sm:py-2.5 text-xs sm:text-sm font-semibold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 hover:border-emerald-300 transition-all shadow-sm"
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
              className="inline-flex items-center gap-1.5 sm:gap-2 rounded-xl border border-primary-200 dark:border-primary-700 bg-primary-50 dark:bg-primary-900/30 px-3 py-2 sm:px-4 sm:py-2.5 text-xs sm:text-sm font-semibold text-primary-700 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-900/50 hover:border-primary-300 transition-all shadow-sm"
            >
              <ExternalLink className="h-4 w-4" />
              Sistema Automatico
            </a>
          )}
          <button
            onClick={onEdit}
            disabled={!!process.lockedAt}
            title={process.lockedAt ? 'Processo travado — destrave para editar' : undefined}
            className={cn(
              'inline-flex items-center gap-1.5 sm:gap-2 rounded-xl border px-3 py-2 sm:px-4 sm:py-2.5 text-xs sm:text-sm font-semibold transition-all shadow-sm',
              process.lockedAt
                ? 'border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed'
                : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-300',
            )}
          >
            <Edit className="h-4 w-4" />
            Editar
          </button>
          {process.lockedAt && (
            <button
              onClick={() => setShowUnlockConfirm(true)}
              className="inline-flex items-center gap-1.5 sm:gap-2 rounded-xl border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 px-3 py-2 sm:px-4 sm:py-2.5 text-xs sm:text-sm font-semibold text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/50 hover:border-amber-300 transition-all shadow-sm"
            >
              <Unlock className="h-4 w-4" />
              Destravar
            </button>
          )}
        </div>
      </div>

      {/* Flags */}
      <ProcessFlags process={process} />

      <ConfirmDialog
        isOpen={showUnlockConfirm}
        variant="danger"
        title="Destravar processo"
        message={`Destravar o processo ${process.processCode}? Aprovação do Vimbar permanece registrada no histórico, mas o sistema voltará a aceitar edições automáticas.`}
        confirmLabel="Destravar"
        onConfirm={handleUnlock}
        onCancel={() => setShowUnlockConfirm(false)}
      />
    </>
  );
}
