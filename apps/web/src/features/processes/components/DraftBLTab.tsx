import { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Clock,
  Upload,
  ChevronDown,
  AlertTriangle,
  AlertCircle,
  Ship,
  Anchor,
  Package,
  Weight,
  DollarSign,
  TreePine,
  Timer,
  FileSearch,
  Loader2,
  Info,
  GitCompareArrows,
  Check,
  X,
} from 'lucide-react';
import { useApiQuery } from '@/shared/hooks/useApi';
import { api } from '@/shared/lib/api-client';
import { cn } from '@/shared/lib/utils';
import { DRAFT_BL_CHECKS } from '@/shared/lib/constants';
import { TableSkeleton } from '@/shared/components/Skeleton';
import { DocumentUpload } from '@/features/documents/DocumentUpload';

// ── Types ──────────────────────────────────────────────────────────────

interface Document {
  id: number;
  fileName: string;
  documentType: string;
  uploadedAt: string;
  aiProcessingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  aiParsedData?: Record<string, any>;
  aiConfidence?: number | null;
}

interface ChecklistState {
  [key: string]: { checked: boolean; timestamp: string | null };
}

interface ValidationCheck {
  checkName: string;
  status: 'passed' | 'failed' | 'warning' | 'skipped';
  expectedValue?: string;
  actualValue?: string;
  documentsCompared?: string;
  message: string;
}

interface DraftBLTabProps {
  processId: string;
}

// ── Helpers ────────────────────────────────────────────────────────────

function getStorageKey(processId: string) {
  return `draft-bl-${processId}`;
}

function loadChecklist(processId: string): ChecklistState {
  try {
    const raw = localStorage.getItem(getStorageKey(processId));
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  const initial: ChecklistState = {};
  for (const check of DRAFT_BL_CHECKS) {
    initial[check.key] = { checked: false, timestamp: null };
  }
  return initial;
}

function saveChecklist(processId: string, state: ChecklistState) {
  localStorage.setItem(getStorageKey(processId), JSON.stringify(state));
}

function getFieldValue(data: Record<string, any> | undefined, key: string): any {
  if (!data) return null;
  const val = data[key];
  if (val && typeof val === 'object' && 'value' in val) return val.value;
  return val ?? null;
}

function displayExtractedValue(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'boolean') return value ? 'Sim' : 'Nao';
  if (Array.isArray(value)) return `${value.length} ${value.length === 1 ? 'item' : 'itens'}`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.description === 'string' && record.description.trim()) {
      return record.description;
    }
    const filled = Object.values(record).filter((nested) => nested != null && nested !== '');
    return filled.length > 0 ? `${filled.length} campos` : null;
  }
  return String(value);
}

function getFieldConfidence(data: Record<string, any> | undefined, key: string): number | null {
  if (!data) return null;
  const val = data[key];
  if (val && typeof val === 'object' && 'confidence' in val) return val.confidence;
  return null;
}

// Formats an extracted date field. Accepts ISO/parsable dates (rendered pt-BR)
// and falls back to the raw string when the IA returned a free-form date.
function formatDateValue(value: unknown): string | null {
  if (value == null || value === '') return null;
  const str = String(value);
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d.toLocaleDateString('pt-BR');
  return str;
}

function formatTimestamp(ts: string | null): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── Section A: Upload / View Draft ─────────────────────────────────────

function DraftUploadSection({
  draftDoc,
  processId,
}: {
  draftDoc: Document | null;
  processId: string;
}) {
  const queryClient = useQueryClient();
  const [showUpload, setShowUpload] = useState(!draftDoc);
  const [isReprocessing, setIsReprocessing] = useState(false);

  const reprocessDraft = async () => {
    if (!draftDoc) return;
    setIsReprocessing(true);
    try {
      await api.post(`/api/documents/${draftDoc.id}/reprocess`);
      toast.success('Reprocessamento do Draft BL iniciado');
      queryClient.invalidateQueries({ queryKey: ['documents', processId] });
      queryClient.invalidateQueries({ queryKey: ['doc-comparison', processId] });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro ao reprocessar Draft BL';
      toast.error(message);
    } finally {
      setIsReprocessing(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
          <FileSearch className="h-4 w-4 text-violet-500" />
          Draft BL
        </h3>
        {draftDoc && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={reprocessDraft}
              disabled={isReprocessing}
              className="text-xs text-slate-400 hover:text-slate-600 dark:text-slate-400 disabled:opacity-50 flex items-center gap-1"
            >
              {isReprocessing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <FileSearch className="h-3 w-3" />
              )}
              Reprocessar
            </button>
            <button
              type="button"
              onClick={() => setShowUpload(!showUpload)}
              className="text-xs text-slate-400 hover:text-slate-600 dark:text-slate-400 flex items-center gap-1"
            >
              <Upload className="h-3 w-3" />
              {showUpload ? 'Ocultar upload' : 'Enviar novo'}
              <ChevronDown
                className={cn('h-3 w-3 transition-transform', showUpload && 'rotate-180')}
              />
            </button>
          </div>
        )}
      </div>

      {draftDoc ? (
        <div className="rounded-lg border border-violet-200 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-950/30 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex shrink-0 rounded border border-violet-200 dark:border-violet-700 bg-violet-50 dark:bg-violet-900/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-violet-700 dark:text-violet-300">
              DRAFT
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                {draftDoc.fileName}
              </p>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span>{new Date(draftDoc.uploadedAt).toLocaleDateString('pt-BR')}</span>
                {draftDoc.aiProcessingStatus === 'processing' && (
                  <span className="inline-flex items-center gap-1 text-primary-500">
                    <Loader2 className="h-3 w-3 animate-spin" /> Processando IA...
                  </span>
                )}
                {draftDoc.aiProcessingStatus === 'completed' && (
                  <span className="inline-flex items-center gap-1 text-emerald-600">
                    <CheckCircle2 className="h-3 w-3" /> Dados extraidos
                  </span>
                )}
                {draftDoc.aiProcessingStatus === 'failed' && (
                  <span className="inline-flex items-center gap-1 text-danger-500">
                    <AlertTriangle className="h-3 w-3" /> Erro na extracao
                  </span>
                )}
                {draftDoc.aiConfidence != null && (
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-medium',
                      draftDoc.aiConfidence >= 0.8
                        ? 'bg-emerald-50 text-emerald-700'
                        : draftDoc.aiConfidence >= 0.5
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-danger-50 text-danger-700',
                    )}
                  >
                    {Math.round(draftDoc.aiConfidence * 100)}%
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border-2 border-dashed border-violet-200 dark:border-violet-800 bg-violet-50/30 dark:bg-violet-950/20 px-4 py-6 text-center">
          <FileSearch className="mx-auto h-8 w-8 text-violet-300" />
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Nenhum Draft BL enviado</p>
          <p className="text-xs text-slate-400">Envie o rascunho do BL abaixo</p>
        </div>
      )}

      {(showUpload || !draftDoc) && (
        <div className="mt-2">
          <DocumentUpload processId={processId} />
        </div>
      )}
    </div>
  );
}

// ── Section B: Conference Checklist ────────────────────────────────────

function ConferenceChecklist({ processId }: { processId: string }) {
  const [checklist, setChecklist] = useState<ChecklistState>(() => loadChecklist(processId));
  const { data: validationChecks, refetch: refetchValidation } = useApiQuery<ValidationCheck[]>(
    ['validation', processId],
    `/api/validation/${processId}`,
  );
  const ncmCheck = validationChecks?.find((check) => check.checkName === 'ncm-bl-description');

  useEffect(() => {
    setChecklist(loadChecklist(processId));
  }, [processId]);

  const toggleCheck = useCallback(
    (key: string) => {
      setChecklist((prev) => {
        const current = prev[key];
        const updated = {
          ...prev,
          [key]: {
            checked: !current?.checked,
            timestamp: !current?.checked ? new Date().toISOString() : null,
          },
        };
        saveChecklist(processId, updated);
        return updated;
      });
    },
    [processId],
  );

  const completedCount = DRAFT_BL_CHECKS.filter((c) => checklist[c.key]?.checked).length;
  const totalChecks = DRAFT_BL_CHECKS.length;
  const progressPct = Math.round((completedCount / totalChecks) * 100);

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-violet-500" />
        Conferencia do Draft BL
      </h3>

      {/* Progress bar */}
      <div className="flex items-center gap-4 rounded-lg bg-slate-50 dark:bg-slate-900 px-4 py-3">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Progresso
            </span>
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {completedCount}/{totalChecks} itens ({progressPct}%)
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                progressPct === 100
                  ? 'bg-emerald-500'
                  : progressPct > 50
                    ? 'bg-violet-500'
                    : 'bg-amber-500',
              )}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              NCMs do OHBL final × Espelho
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              A regra compara todos os quatro primeiros dígitos do OHBL final com os NCMs do
              Espelho. Invoice e Packing List não são usados como fonte de NCM neste controle.
            </p>
          </div>
          <button
            type="button"
            onClick={() => refetchValidation()}
            className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Atualizar
          </button>
        </div>
        {ncmCheck ? (
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-[auto_1fr] sm:items-start">
            <span
              className={cn(
                'inline-flex w-fit rounded-full px-2 py-1 font-semibold',
                ncmCheck.status === 'passed'
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                  : ncmCheck.status === 'failed'
                    ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                    : ncmCheck.status === 'warning'
                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
              )}
            >
              {ncmCheck.status === 'passed'
                ? 'Conforme'
                : ncmCheck.status === 'failed'
                  ? 'Divergente'
                  : ncmCheck.status === 'warning'
                    ? 'Revisar'
                    : 'Aguardando'}
            </span>
            <div className="min-w-0 text-slate-600 dark:text-slate-300">
              <p>{ncmCheck.message}</p>
              {(ncmCheck.expectedValue || ncmCheck.actualValue) && (
                <p className="mt-1 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                  Espelho: {ncmCheck.expectedValue || '—'} · OHBL: {ncmCheck.actualValue || '—'}
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Aguardando a validação automática do processo.
          </p>
        )}
      </div>

      {/* Checklist items */}
      <div className="space-y-1">
        {DRAFT_BL_CHECKS.map((check, index) => {
          const state = checklist[check.key];
          const isChecked = state?.checked ?? false;
          const timestamp = formatTimestamp(state?.timestamp ?? null);

          return (
            <button
              key={check.key}
              type="button"
              onClick={() => toggleCheck(check.key)}
              className={cn(
                'group flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-all',
                isChecked
                  ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/30 hover:bg-emerald-50 dark:hover:bg-emerald-950/50'
                  : 'border-slate-150 dark:border-slate-600 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-200',
              )}
            >
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                  isChecked
                    ? 'bg-emerald-500 text-white'
                    : 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400',
                )}
              >
                {isChecked ? <CheckCircle2 className="h-3.5 w-3.5" /> : String(index + 1)}
              </span>

              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'text-sm font-medium',
                    isChecked
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-slate-700 dark:text-slate-300',
                  )}
                >
                  {check.label}
                </p>
                <p className="text-xs text-slate-400 truncate">{check.description}</p>
              </div>

              <div className="shrink-0 text-right">
                {isChecked && timestamp ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
                    <Clock className="h-3 w-3" />
                    {timestamp}
                  </span>
                ) : (
                  <span className="text-[11px] text-slate-300 group-hover:text-slate-400">
                    Clique para conferir
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

// ── Section C: AI Extracted Data ───────────────────────────────────────

interface ExtractedFieldProps {
  label: string;
  value: any;
  confidence?: number | null;
  icon?: React.ElementType;
  warning?: string | null;
}

function ExtractedField({ label, value, confidence, icon: Icon, warning }: ExtractedFieldProps) {
  const displayValue = displayExtractedValue(value) ?? '--';
  const isPlaceholder = displayValue === '--';

  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2.5',
        warning
          ? 'border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/30'
          : 'border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800',
      )}
    >
      <div className="flex items-center gap-1.5 mb-1">
        {Icon && <Icon className="h-3.5 w-3.5 text-slate-400" />}
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          {label}
        </span>
        {confidence != null && (
          <span
            className={cn(
              'ml-auto rounded-full px-1.5 py-0.5 text-[9px] font-medium',
              confidence >= 0.8
                ? 'bg-emerald-50 text-emerald-600'
                : confidence >= 0.5
                  ? 'bg-amber-50 text-amber-600'
                  : 'bg-danger-50 text-danger-600',
            )}
          >
            {Math.round(confidence * 100)}%
          </span>
        )}
      </div>
      <p
        className={cn(
          'text-sm font-medium truncate',
          isPlaceholder ? 'text-slate-300 italic' : 'text-slate-800 dark:text-slate-100',
        )}
      >
        {displayValue}
      </p>
      {warning && (
        <p className="mt-1 text-[11px] text-amber-600 flex items-center gap-1">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {warning}
        </p>
      )}
    </div>
  );
}

function AIExtractedData({
  draftDoc,
  ohblDoc,
}: {
  draftDoc: Document | null;
  ohblDoc: Document | null;
}) {
  // Default to OHBL (final) when available; allow operator to toggle back to draft.
  const hasFinal =
    !!ohblDoc && ohblDoc.aiProcessingStatus === 'completed' && !!ohblDoc.aiParsedData;
  const [showDraft, setShowDraft] = useState(false);
  const activeDoc = hasFinal && !showDraft ? ohblDoc : draftDoc;

  if (!activeDoc || activeDoc.aiProcessingStatus !== 'completed' || !activeDoc.aiParsedData) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
          <Info className="h-4 w-4 text-violet-500" />
          Dados Extraidos pela IA
        </h3>
        <div className="rounded-lg border border-slate-100 dark:border-slate-700 bg-slate-50/50 px-4 py-8 text-center">
          {!activeDoc ? (
            <p className="text-sm text-slate-400">Envie um Draft BL para ver os dados extraidos</p>
          ) : activeDoc.aiProcessingStatus === 'processing' ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-6 w-6 text-violet-400 animate-spin" />
              <p className="text-sm text-slate-400">Processando com IA...</p>
            </div>
          ) : (
            <p className="text-sm text-slate-400">Extracao IA nao disponivel</p>
          )}
        </div>
      </div>
    );
  }

  const data = activeDoc.aiParsedData;
  const isShowingFinal = activeDoc === ohblDoc;
  // Prefer the extracted issue date (data de emissão) of the BL Final; fall back
  // honestly to the upload date when the document didn't carry an issue date.
  const ohblIssueDate = ohblDoc?.aiParsedData
    ? formatDateValue(getFieldValue(ohblDoc.aiParsedData, 'issueDate'))
    : null;
  const finalUploadDate = ohblDoc?.uploadedAt
    ? new Date(ohblDoc.uploadedAt).toLocaleDateString('pt-BR')
    : null;
  // Label honestly: "emitido" only when we truly have the issue date; otherwise "recebido em".
  const finalDateBadge = ohblIssueDate
    ? `BL Final · emitido ${ohblIssueDate}`
    : finalUploadDate
      ? `BL Final · recebido em ${finalUploadDate}`
      : 'BL Final';
  const woodDeclaration = getFieldValue(data, 'woodDeclaration');
  const freeTime = getFieldValue(data, 'freeTime');
  const ncmList = getFieldValue(data, 'ncmList');
  const ncmPrefixes = Array.isArray(ncmList)
    ? [
        ...new Set(
          ncmList.map((ncm: unknown) => String(ncm).replace(/\D/g, '').slice(0, 4)).filter(Boolean),
        ),
      ]
    : [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
          <Info className="h-4 w-4 text-violet-500" />
          Dados Extraidos pela IA
        </h3>
        {hasFinal && (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
              isShowingFinal ? 'bg-emerald-100 text-emerald-700' : 'bg-violet-100 text-violet-700',
            )}
          >
            {isShowingFinal ? finalDateBadge : 'Versao do Draft'}
          </span>
        )}
        {hasFinal && (
          <button
            onClick={() => setShowDraft((v) => !v)}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            <GitCompareArrows className="h-3 w-3" />
            {showDraft ? 'Ver dados do BL Final' : 'Ver dados do Draft'}
          </button>
        )}
      </div>

      {/* Critical warnings */}
      {woodDeclaration === false && (
        <div className="flex items-center gap-2 rounded-lg border border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-950/30 px-4 py-2.5">
          <AlertTriangle className="h-4 w-4 text-danger-500 shrink-0" />
          <div>
            <p className="text-sm font-medium text-danger-700">
              Declaracao de Madeira NAO encontrada
            </p>
            <p className="text-xs text-danger-500">
              A declaracao de madeira e obrigatoria. Solicite ao agente de carga.
            </p>
          </div>
        </div>
      )}

      {(freeTime == null || freeTime === '') && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-2.5">
          <Timer className="h-4 w-4 text-amber-500 shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-700">Free Time nao informado</p>
            <p className="text-xs text-amber-500">
              Verifique se o free time negociado consta no BL.
            </p>
          </div>
        </div>
      )}

      {/* Main fields grid */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <ExtractedField
          label="Embarcador / Shipper"
          value={getFieldValue(data, 'shipper')}
          confidence={getFieldConfidence(data, 'shipper')}
          icon={Package}
        />
        <ExtractedField
          label="Consignee"
          value={getFieldValue(data, 'consignee')}
          confidence={getFieldConfidence(data, 'consignee')}
          icon={Package}
        />
        <ExtractedField
          label="Porto Embarque"
          value={getFieldValue(data, 'portOfLoading')}
          confidence={getFieldConfidence(data, 'portOfLoading')}
          icon={Anchor}
        />
        <ExtractedField
          label="Porto Destino"
          value={getFieldValue(data, 'portOfDischarge')}
          confidence={getFieldConfidence(data, 'portOfDischarge')}
          icon={Anchor}
        />
        <ExtractedField
          label="Navio"
          value={getFieldValue(data, 'vesselName')}
          confidence={getFieldConfidence(data, 'vesselName')}
          icon={Ship}
        />
        <ExtractedField
          label="Container"
          value={getFieldValue(data, 'containerNumber')}
          confidence={getFieldConfidence(data, 'containerNumber')}
          icon={Package}
        />
        <ExtractedField
          label="Peso Bruto (kg)"
          value={getFieldValue(data, 'totalGrossWeight')}
          confidence={getFieldConfidence(data, 'totalGrossWeight')}
          icon={Weight}
        />
        <ExtractedField
          label="CBM (m3)"
          value={getFieldValue(data, 'totalCbm')}
          confidence={getFieldConfidence(data, 'totalCbm')}
          icon={Package}
        />
        <ExtractedField
          label="Frete"
          value={(() => {
            const val = getFieldValue(data, 'freightValue');
            const cur = getFieldValue(data, 'freightCurrency');
            if (val != null && cur) return `${cur} ${val}`;
            if (val != null) return val;
            if (cur) return cur;
            return null;
          })()}
          confidence={getFieldConfidence(data, 'freightValue')}
          icon={DollarSign}
        />
        <ExtractedField
          label="Free Time"
          value={freeTime != null ? `${freeTime} dias` : null}
          confidence={getFieldConfidence(data, 'freeTime')}
          icon={Timer}
          warning={freeTime == null ? 'Nao informado' : null}
        />
        <ExtractedField
          label="Declaracao de Madeira"
          value={woodDeclaration === true ? 'Sim' : woodDeclaration === false ? 'Nao' : null}
          confidence={getFieldConfidence(data, 'woodDeclaration')}
          icon={TreePine}
          warning={woodDeclaration === false ? 'OBRIGATORIO - Nao encontrada' : null}
        />
        <ExtractedField
          label="Total Caixas"
          value={getFieldValue(data, 'totalBoxes')}
          confidence={getFieldConfidence(data, 'totalBoxes')}
          icon={Package}
        />
      </div>

      {/* NCM List */}
      {Array.isArray(ncmList) && ncmList.length > 0 && (
        <div className="rounded-lg border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
            NCMs encontrados ({ncmList.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {ncmList.map((ncm: string, i: number) => (
              <span
                key={i}
                className="inline-flex rounded-full bg-slate-100 dark:bg-slate-700 px-2.5 py-0.5 text-xs font-mono font-medium text-slate-700 dark:text-slate-300"
              >
                {ncm}
              </span>
            ))}
          </div>
          {ncmPrefixes.length > 0 && (
            <div className="mt-2 border-t border-slate-100 pt-2 dark:border-slate-700">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Prefixos validados (4 digitos)
              </p>
              <div className="flex flex-wrap gap-1.5">
                {ncmPrefixes.map((prefix) => (
                  <span
                    key={prefix}
                    className="inline-flex rounded bg-emerald-50 px-2 py-0.5 text-xs font-mono font-semibold text-emerald-700"
                  >
                    {prefix}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Cargo description */}
      {getFieldValue(data, 'cargoDescription') && (
        <CargoDescription text={String(getFieldValue(data, 'cargoDescription'))} />
      )}
    </div>
  );
}

// Expand/collapse cargo-description text so long descriptions are never silently
// truncated. Reused inside comparison-table cells (Sections D and E) where every
// other field truncates but the cargo description must stay fully legible.
function ExpandableCargoText({
  text,
  className,
  clampLines = 6,
}: {
  text: string;
  className?: string;
  clampLines?: 4 | 6;
}) {
  const [expanded, setExpanded] = useState(false);
  // Only offer a toggle when the text is long enough to be clamped.
  const isLong = text.length > 280 || text.split('\n').length > clampLines;

  return (
    <div>
      <p
        className={cn(
          'whitespace-pre-wrap',
          isLong && !expanded && (clampLines === 4 ? 'line-clamp-4' : 'line-clamp-6'),
          className,
        )}
      >
        {text}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-violet-600 hover:text-violet-700"
        >
          <ChevronDown className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')} />
          {expanded ? 'Ver menos' : 'Ver mais'}
        </button>
      )}
    </div>
  );
}

// Cargo description block (Section C) — full-width card wrapper around the
// shared expand/collapse text.
function CargoDescription({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
        Descricao da Carga
      </p>
      <ExpandableCargoText text={text} className="text-xs text-slate-600 dark:text-slate-400" />
    </div>
  );
}

// ── Section D: Documento Revisado ──────────────────────────────────────

const COMPARISON_FIELDS: { key: string; label: string }[] = [
  { key: 'shipper', label: 'Shipper' },
  { key: 'consignee', label: 'Consignee' },
  { key: 'portOfLoading', label: 'Porto Embarque' },
  { key: 'portOfDischarge', label: 'Porto Destino' },
  { key: 'vesselName', label: 'Navio' },
  { key: 'containerNumber', label: 'Container' },
  { key: 'totalGrossWeight', label: 'Peso Bruto' },
  { key: 'totalCbm', label: 'CBM' },
  { key: 'freightValue', label: 'Frete Valor' },
  { key: 'freightCurrency', label: 'Frete Moeda' },
  { key: 'freeTime', label: 'Free Time' },
  { key: 'woodDeclaration', label: 'Declaracao Madeira' },
  { key: 'totalBoxes', label: 'Total Caixas' },
  { key: 'cargoDescription', label: 'Descricao Carga' },
];

function computeDifferences(
  draftData: Record<string, any> | undefined,
  revisadoData: Record<string, any> | undefined,
): { key: string; label: string; draftValue: string; revisadoValue: string; changed: boolean }[] {
  return COMPARISON_FIELDS.map((field) => {
    const draftVal = getFieldValue(draftData, field.key);
    const revisadoVal = getFieldValue(revisadoData, field.key);
    const draftStr = draftVal != null && draftVal !== '' ? String(draftVal) : '--';
    const revisadoStr = revisadoVal != null && revisadoVal !== '' ? String(revisadoVal) : '--';
    return {
      key: field.key,
      label: field.label,
      draftValue: draftStr,
      revisadoValue: revisadoStr,
      changed: draftStr !== revisadoStr,
    };
  });
}

function RevisadoSection({ draftDocs, processId }: { draftDocs: Document[]; processId: string }) {
  const [showUpload, setShowUpload] = useState(false);

  const originalDoc = draftDocs.length >= 2 ? draftDocs[0] : null;
  const revisadoDoc = draftDocs.length >= 2 ? draftDocs[draftDocs.length - 1] : null;
  const hasRevisado = originalDoc !== null && revisadoDoc !== null;

  const differences =
    hasRevisado &&
    originalDoc.aiProcessingStatus === 'completed' &&
    revisadoDoc.aiProcessingStatus === 'completed' &&
    originalDoc.aiParsedData &&
    revisadoDoc.aiParsedData
      ? computeDifferences(originalDoc.aiParsedData, revisadoDoc.aiParsedData)
      : null;

  const changedCount = differences?.filter((d) => d.changed).length ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
          <GitCompareArrows className="h-4 w-4 text-violet-500" />
          Documento Revisado
        </h3>
        <button
          onClick={() => setShowUpload(!showUpload)}
          className="text-xs text-slate-400 hover:text-slate-600 dark:text-slate-400 flex items-center gap-1"
        >
          <Upload className="h-3 w-3" />
          {showUpload ? 'Ocultar upload' : 'Enviar Documento Revisado'}
          <ChevronDown className={cn('h-3 w-3 transition-transform', showUpload && 'rotate-180')} />
        </button>
      </div>

      {hasRevisado ? (
        <div className="space-y-3">
          {/* Revisado document info */}
          <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/30 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="inline-flex shrink-0 rounded border border-emerald-200 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-700 dark:text-emerald-300">
                REVISADO
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                  {revisadoDoc.fileName}
                </p>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span>{new Date(revisadoDoc.uploadedAt).toLocaleDateString('pt-BR')}</span>
                  {revisadoDoc.aiProcessingStatus === 'processing' && (
                    <span className="inline-flex items-center gap-1 text-primary-500">
                      <Loader2 className="h-3 w-3 animate-spin" /> Processando IA...
                    </span>
                  )}
                  {revisadoDoc.aiProcessingStatus === 'completed' && (
                    <span className="inline-flex items-center gap-1 text-emerald-600">
                      <CheckCircle2 className="h-3 w-3" /> Dados extraidos
                    </span>
                  )}
                  {revisadoDoc.aiProcessingStatus === 'failed' && (
                    <span className="inline-flex items-center gap-1 text-danger-500">
                      <AlertTriangle className="h-3 w-3" /> Erro na extracao
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Comparison table */}
          {differences && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="font-medium">Comparativo Draft vs Revisado</span>
                {changedCount > 0 ? (
                  <span className="rounded-full bg-amber-100 dark:bg-amber-900/50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                    {changedCount} {changedCount === 1 ? 'alteracao' : 'alteracoes'}
                  </span>
                ) : (
                  <span className="rounded-full bg-emerald-100 dark:bg-emerald-900/50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                    Sem alteracoes
                  </span>
                )}
              </div>

              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-600">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-900 text-left">
                      <th className="px-3 py-2 font-semibold text-slate-500 dark:text-slate-400">
                        Campo
                      </th>
                      <th className="px-3 py-2 font-semibold text-slate-500 dark:text-slate-400">
                        Draft
                      </th>
                      <th className="px-3 py-2 font-semibold text-slate-500 dark:text-slate-400">
                        Revisado
                      </th>
                      <th className="px-3 py-2 font-semibold text-slate-500 dark:text-slate-400 text-center w-20">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    {differences.map((diff) => {
                      // Cargo description must stay fully legible: use the shared
                      // expand/collapse instead of truncating like the other fields.
                      const isCargo = diff.key === 'cargoDescription';
                      return (
                        <tr
                          key={diff.key}
                          className={cn(
                            diff.changed
                              ? 'bg-amber-50/50 dark:bg-amber-950/30'
                              : 'bg-white dark:bg-slate-800',
                          )}
                        >
                          <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300 align-top">
                            {diff.label}
                          </td>
                          <td
                            className={cn(
                              'px-3 py-2 text-slate-600 dark:text-slate-400 align-top',
                              isCargo ? 'max-w-[260px]' : 'max-w-[150px] truncate',
                            )}
                          >
                            {isCargo && diff.draftValue !== '--' ? (
                              <ExpandableCargoText text={diff.draftValue} clampLines={4} />
                            ) : (
                              diff.draftValue
                            )}
                          </td>
                          <td
                            className={cn(
                              'px-3 py-2 align-top',
                              isCargo ? 'max-w-[260px]' : 'max-w-[150px] truncate',
                              diff.changed
                                ? 'text-amber-700 font-medium'
                                : 'text-slate-600 dark:text-slate-400',
                            )}
                          >
                            {isCargo && diff.revisadoValue !== '--' ? (
                              <ExpandableCargoText text={diff.revisadoValue} clampLines={4} />
                            ) : (
                              diff.revisadoValue
                            )}
                          </td>
                          <td className="px-3 py-2 text-center align-top">
                            {diff.changed ? (
                              <span className="inline-flex items-center gap-1 text-amber-600">
                                <X className="h-3 w-3" />
                                Alterado
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-emerald-600">
                                <Check className="h-3 w-3" />
                                OK
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border-2 border-dashed border-slate-200 dark:border-slate-600 bg-slate-50/30 px-4 py-6 text-center">
          <GitCompareArrows className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Nenhum documento revisado
          </p>
          <p className="text-xs text-slate-400">
            Envie a versao revisada do Draft BL apos a conferencia
          </p>
        </div>
      )}

      {showUpload && (
        <div className="mt-2">
          <DocumentUpload processId={processId} />
        </div>
      )}
    </div>
  );
}

// ── Section E: Draft BL vs BL Final (Revisado) ─────────────────────────

interface DraftBlRevision {
  field: string;
  label: string;
  draftValue: string | null;
  finalValue: string | null;
  isRevised: boolean;
}

interface ComparisonData {
  hasDraftBl?: boolean;
  hasBl?: boolean;
  draftBlRevisions?: DraftBlRevision[];
}

function DraftVsFinalSection({
  processId,
  hasOhbl,
  ohblDateLabel,
}: {
  processId: string;
  hasOhbl: boolean;
  // Pre-built, honest label: "emitido <data>" only with a real issue date,
  // otherwise "recebido em <upload>".
  ohblDateLabel: string | null;
}) {
  const { data } = useApiQuery<ComparisonData>(
    ['doc-comparison', processId, 'draft-vs-final'],
    `/api/documents/process/${processId}/comparison`,
    { enabled: hasOhbl, staleTime: 30_000 },
  );

  if (!hasOhbl) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
          <GitCompareArrows className="h-4 w-4 text-violet-500" />
          Draft BL vs BL Final
        </h3>
        <div className="rounded-lg border border-slate-100 dark:border-slate-700 bg-slate-50/50 px-4 py-6 text-center">
          <p className="text-sm text-slate-400">
            O BL Final (OHBL) ainda nao chegou — comparativo aparecera aqui assim que for emitido.
          </p>
        </div>
      </div>
    );
  }

  const revisions = data?.draftBlRevisions ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
          <GitCompareArrows className="h-4 w-4 text-violet-500" />
          Draft BL vs BL Final
        </h3>
        {ohblDateLabel && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
            {ohblDateLabel}
          </span>
        )}
        {revisions.length > 0 && (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-700">
            {revisions.length} campo(s) revisado(s)
          </span>
        )}
      </div>

      {revisions.length === 0 ? (
        <div className="rounded-lg border border-emerald-100 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 px-4 py-3 text-sm text-emerald-700">
          <Check className="inline h-4 w-4 mr-1" /> Nenhum campo divergente entre o Draft e o BL
          Final.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-violet-200 dark:border-violet-800">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-violet-50/50 dark:bg-violet-950/20">
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-violet-500">
                  Campo
                </th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Draft BL
                </th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-emerald-500">
                  BL Final
                </th>
              </tr>
            </thead>
            <tbody>
              {revisions.map((rev, i) => {
                // Cargo description stays fully legible via expand/collapse; other
                // fields keep their compact single-line rendering.
                const isCargo = rev.field === 'cargoDescription';
                return (
                  <tr key={i} className="border-b last:border-b-0">
                    <td className="px-3 py-2.5 align-top">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center rounded-md bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
                          Revisado
                        </span>
                        <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                          {rev.label}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-top text-sm font-mono text-slate-500 dark:text-slate-400">
                      {isCargo && rev.draftValue ? (
                        <ExpandableCargoText
                          text={rev.draftValue}
                          clampLines={4}
                          className="line-through"
                        />
                      ) : (
                        <span className="line-through">{rev.draftValue ?? '—'}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 align-top text-sm font-mono text-emerald-700 font-semibold">
                      {isCargo && rev.finalValue ? (
                        <ExpandableCargoText text={rev.finalValue} clampLines={4} />
                      ) : (
                        (rev.finalValue ?? '—')
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────

export function DraftBLTab({ processId }: DraftBLTabProps) {
  const { data: documents, isLoading } = useApiQuery<Document[]>(
    ['documents', processId],
    `/api/documents/process/${processId}`,
    {
      refetchInterval: (query) => {
        const docs = query.state.data;
        if (!docs) return false;
        const hasDraftProcessing = docs.some(
          (d) =>
            (d.documentType === 'draft_bl' || d.documentType === 'ohbl') &&
            (d.aiProcessingStatus === 'processing' || d.aiProcessingStatus === 'pending'),
        );
        return hasDraftProcessing ? 5000 : false;
      },
    },
  );

  if (isLoading) return <TableSkeleton />;

  // The most recently uploaded draft is the active one. Older uploads remain
  // available in Documentos as historical evidence and must not be reprocessed
  // by the action shown in this operational tab.
  const allDraftDocs = (documents ?? [])
    .filter((d) => d.documentType === 'draft_bl')
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

  // First draft_bl is the current operational draft, shown in sections A and C.
  const draftDoc = allDraftDocs.length > 0 ? allDraftDocs[0] : null;

  // OHBL (final BL) — when present, Section C swaps to its data
  const ohblDoc =
    (documents ?? [])
      .filter((d) => d.documentType === 'ohbl')
      .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())[0] ??
    null;

  const ohblUploadDate = ohblDoc?.uploadedAt
    ? new Date(ohblDoc.uploadedAt).toLocaleDateString('pt-BR')
    : null;
  // Real issue date (data de emissão) when the IA extracted it from the BL Final.
  const ohblIssueDate = ohblDoc?.aiParsedData
    ? formatDateValue(getFieldValue(ohblDoc.aiParsedData, 'issueDate'))
    : null;
  // Honest badge label: "emitido" only with a true issue date, else "recebido em".
  const ohblDateLabel = ohblIssueDate
    ? `BL Final emitido ${ohblIssueDate}`
    : ohblUploadDate
      ? `BL Final recebido em ${ohblUploadDate}`
      : null;

  // Once the OHBL (final BL) has arrived, the draft + revisado history becomes
  // background context — Nicolas's words (2026-05-21 meeting): "quando eu subir
  // o BL original aqui ele precisa começar a considerar só o que tá no BL
  // original. Daí draft e revisado desaparecem pra gente."
  const hasFinal = !!ohblDoc;

  return (
    <div className="space-y-6">
      {hasFinal && (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3">
          <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
            {ohblIssueDate
              ? `BL Final (OHBL) emitido em ${ohblIssueDate}.`
              : `BL Final (OHBL) recebido em ${ohblUploadDate}.`}{' '}
            Os dados exibidos abaixo agora refletem o BL Final. O histórico do draft fica disponível
            em "Histórico do Draft".
          </p>
        </div>
      )}

      {!hasFinal && (
        <>
          {/* Section A: Upload / View Draft */}
          <DraftUploadSection draftDoc={draftDoc} processId={processId} />

          {/* Divider */}
          <div className="border-t border-slate-100 dark:border-slate-700" />

          {/* Section B: Conference Checklist */}
          <ConferenceChecklist processId={processId} />

          {/* Divider */}
          <div className="border-t border-slate-100 dark:border-slate-700" />
        </>
      )}

      {/* Section C: AI Extracted Data — swaps to OHBL when emitted */}
      <AIExtractedData draftDoc={draftDoc} ohblDoc={ohblDoc} />

      {/* Section E: Draft BL vs BL Final (always when OHBL present) */}
      {hasFinal && (
        <>
          <div className="border-t border-slate-100 dark:border-slate-700" />
          <DraftVsFinalSection
            processId={processId}
            hasOhbl={hasFinal}
            ohblDateLabel={ohblDateLabel}
          />
        </>
      )}

      {/* Section D: Documento Revisado (Draft mais antigo vs Draft mais novo) */}
      {!hasFinal && allDraftDocs.length > 1 && (
        <>
          <div className="border-t border-slate-100 dark:border-slate-700" />
          <RevisadoSection draftDocs={allDraftDocs} processId={processId} />
        </>
      )}

      {/* Collapsible: Histórico do Draft (only after OHBL) */}
      {hasFinal && (
        <details className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30">
          <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
            Histórico do Draft (upload, checklist, revisões anteriores)
          </summary>
          <div className="space-y-6 px-4 py-4">
            <DraftUploadSection draftDoc={draftDoc} processId={processId} />
            <div className="border-t border-slate-100 dark:border-slate-700" />
            <ConferenceChecklist processId={processId} />
            {allDraftDocs.length > 1 && (
              <>
                <div className="border-t border-slate-100 dark:border-slate-700" />
                <RevisadoSection draftDocs={allDraftDocs} processId={processId} />
              </>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
